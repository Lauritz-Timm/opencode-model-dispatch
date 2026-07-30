import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

guard CommandLine.arguments.count == 2 else {
  fail("Apple notarization log validator requires one path")
}

do {
  let data = try Data(
    contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])
  )
  guard let root = try JSONSerialization.jsonObject(with: data)
    as? [String: Any],
    root.keys.contains("issues")
  else {
    fail("Apple notarization log must be a JSON object with issues")
  }
  let issues = root["issues"]!
  if issues is NSNull {
    exit(0)
  }
  guard let issueList = issues as? [Any], issueList.isEmpty else {
    fail("Apple notarization log contains issues or warnings")
  }
} catch {
  fail("Apple notarization log is invalid JSON: \(error)")
}
