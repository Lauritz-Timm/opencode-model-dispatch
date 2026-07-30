use std::io::{self, BufRead, Write};

use tauri::{Emitter, Manager};

// Keep this value in sync with MAX_PICKER_RPC_LINE_BYTES in
// picker/src/runtime-limits.ts.
const MAX_PICKER_RPC_LINE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
enum BoundedLine {
    Complete(String),
    TooLong,
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    maximum: usize,
) -> io::Result<Option<BoundedLine>> {
    let mut bytes = Vec::with_capacity(maximum.min(8 * 1024));
    let mut too_long = false;

    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if too_long {
                return Ok(Some(BoundedLine::TooLong));
            }
            if bytes.is_empty() {
                return Ok(None);
            }
            return String::from_utf8(bytes)
                .map(BoundedLine::Complete)
                .map(Some)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error));
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |position| position + 1);
        let content = newline.map_or(available, |position| &available[..position]);

        if !too_long {
            let remaining = maximum.saturating_sub(bytes.len());
            if content.len() <= remaining {
                bytes.extend_from_slice(content);
            } else {
                bytes.clear();
                too_long = true;
            }
        }

        reader.consume(consumed);

        if newline.is_some() {
            if too_long {
                return Ok(Some(BoundedLine::TooLong));
            }
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            return String::from_utf8(bytes)
                .map(BoundedLine::Complete)
                .map(Some)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error));
        }
    }
}

#[tauri::command]
fn write_stdout_line(line: String) -> Result<(), String> {
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();

    stdout
        .write_all(line.as_bytes())
        .and_then(|_| stdout.write_all(b"\n"))
        .and_then(|_| stdout.flush())
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();

            std::thread::spawn(move || {
                let stdin = std::io::stdin();
                let mut stdin = stdin.lock();

                loop {
                    match read_bounded_line(&mut stdin, MAX_PICKER_RPC_LINE_BYTES) {
                        Ok(Some(BoundedLine::Complete(line))) => {
                            if let Err(error) = app_handle.emit("picker-rpc-message", line) {
                                eprintln!("failed to emit picker rpc message: {error}");
                            }
                        }
                        Ok(Some(BoundedLine::TooLong)) => {
                            eprintln!(
                                "rejected picker rpc stdin line larger than {MAX_PICKER_RPC_LINE_BYTES} bytes"
                            );
                            // A rejected start request cannot be recovered in the
                            // current picker session. Exit so the owning plugin
                            // immediately takes its technical-failure fallback.
                            app_handle.exit(1);
                            return;
                        }
                        Ok(None) => break,
                        Err(error) => {
                            eprintln!("failed to read picker rpc stdin: {error}");
                            break;
                        }
                    }
                }
                // The plugin owns this process. If its stdin closes, the host is
                // gone and keeping a detached picker window alive is incorrect.
                app_handle.exit(0);
            });

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.center();
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![write_stdout_line])
        .run(tauri::generate_context!())
        .expect("failed to run picker app");
}

#[cfg(test)]
mod tests {
    use super::{read_bounded_line, BoundedLine};
    use std::io::Cursor;

    #[test]
    fn reads_a_valid_complete_line() {
        let mut input = Cursor::new(b"{\"jsonrpc\":\"2.0\",\"method\":\"start\"}\n");

        assert_eq!(
            read_bounded_line(&mut input, 128).unwrap(),
            Some(BoundedLine::Complete(
                "{\"jsonrpc\":\"2.0\",\"method\":\"start\"}".to_owned()
            ))
        );
        assert_eq!(read_bounded_line(&mut input, 128).unwrap(), None);
    }

    #[test]
    fn rejects_an_oversized_unterminated_line_without_losing_the_bound() {
        let mut input = Cursor::new(vec![b'x'; 129]);

        assert_eq!(
            read_bounded_line(&mut input, 128).unwrap(),
            Some(BoundedLine::TooLong)
        );
        assert_eq!(read_bounded_line(&mut input, 128).unwrap(), None);
    }

    #[test]
    fn resumes_after_a_terminated_oversized_line() {
        let mut input = Cursor::new(b"123456789\nvalid\n");

        assert_eq!(
            read_bounded_line(&mut input, 8).unwrap(),
            Some(BoundedLine::TooLong)
        );
        assert_eq!(
            read_bounded_line(&mut input, 8).unwrap(),
            Some(BoundedLine::Complete("valid".to_owned()))
        );
    }
}
