use std::io::{BufRead, Write};

use tauri::{Emitter, Manager};

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

                for line in stdin.lock().lines() {
                    match line {
                        Ok(line) => {
                            if let Err(error) = app_handle.emit("picker-rpc-message", line) {
                                eprintln!("failed to emit picker rpc message: {error}");
                            }
                        }
                        Err(error) => {
                            eprintln!("failed to read picker rpc stdin: {error}");
                            break;
                        }
                    }
                }
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
