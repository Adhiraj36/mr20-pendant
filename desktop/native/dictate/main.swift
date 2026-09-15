// lyzn-dictate: what you say, as text for the composer, recognised on this Mac.
//
// Speaks JSON lines on stdout:
//   {"type":"ready"}                          listening
//   {"type":"level","value":0.42}             input loudness, 0-1, ~15 times a second
//   {"type":"partial","text":"..."}           the transcript so far
//   {"type":"final","text":"..."}             the transcript, settled; the process then exits
//   {"type":"error","code":"...","message":"..."}
// and reads "stop" (finish and send a final) or "cancel" (exit, no final) on
// stdin. EOF on stdin is a stop.
//
// macOS decides microphone and speech permissions against the *responsible*
// process's Info.plist. Spawned by Electron that is Electron, whose plist has
// no speech usage string, and the first request would kill the process. So the
// helper relaunches itself with responsibility disclaimed, and this bundle's
// own Info.plist is the one macOS reads.
import AVFoundation
import Foundation
import Speech

@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

let out = DispatchQueue(label: "ai.lyzn.dictate.out")

func emit(_ obj: [String: Any]) {
  out.sync {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
  }
}

func fail(_ code: String, _ message: String, status: Int32 = 1) -> Never {
  emit(["type": "error", "code": code, "message": message])
  exit(status)
}

// MARK: - The disclaimed relaunch

func relaunchDisclaimed() -> Never {
  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  _ = responsibility_spawnattrs_setdisclaim(&attr, 1)

  var env = ProcessInfo.processInfo.environment
  env["LYZN_DICTATE_DISCLAIMED"] = "1"
  let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  let envp: [UnsafeMutablePointer<CChar>?] = env.map { strdup("\($0.key)=\($0.value)") } + [nil]

  var pid: pid_t = 0
  let rc = posix_spawn(&pid, path, nil, &attr, argv, envp)
  if rc != 0 { fail("failed", "Dictation could not start (\(rc)).") }

  // The window stops dictation by signalling this process; the child is the
  // one listening, so the signal is passed on.
  for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
    source.setEventHandler { kill(pid, sig) }
    source.resume()
    sources.append(source)
  }

  DispatchQueue.global().async {
    var status: Int32 = 0
    waitpid(pid, &status, 0)
    let exited = (status & 0x7f) == 0
    exit(exited ? (status >> 8) & 0xff : 1)
  }
  dispatchMain()
}

var sources: [DispatchSourceSignal] = []

// MARK: - Listening

final class Dictation {
  let recognizer: SFSpeechRecognizer
  let request = SFSpeechAudioBufferRecognitionRequest()
  let engine = AVAudioEngine()
  var task: SFSpeechRecognitionTask?
  var latest = ""
  var stopping = false
  var finished = false
  var lastLevel = Date.distantPast

  init(recognizer: SFSpeechRecognizer) {
    self.recognizer = recognizer
  }

  func start() {
    request.shouldReportPartialResults = true
    if #available(macOS 13, *) { request.addsPunctuation = true }
    // On this Mac when the language allows it; Apple's servers otherwise.
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      fail("no-mic", "No microphone is available.", status: 4)
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      guard let self else { return }
      self.request.append(buffer)
      self.level(buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      fail("no-mic", "The microphone could not be opened: \(error.localizedDescription)", status: 4)
    }

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        self.latest = result.bestTranscription.formattedString
        if result.isFinal {
          self.finish()
          return
        }
        emit(["type": "partial", "text": self.latest])
      }
      if let error {
        // Stopping early, or silence, both end in an error with nothing
        // wrong: what was heard is still the answer.
        if self.stopping || !self.latest.isEmpty {
          self.finish()
        } else {
          let code = (error as NSError).code == 1110 ? "no-speech" : "failed"
          fail(code, error.localizedDescription, status: code == "no-speech" ? 0 : 1)
        }
      }
    }
    emit(["type": "ready"])

    // Apple ends a recognition request at about a minute.
    DispatchQueue.main.asyncAfter(deadline: .now() + 58) { [weak self] in self?.stop() }
  }

  func level(_ buffer: AVAudioPCMBuffer) {
    let now = Date()
    guard now.timeIntervalSince(lastLevel) > 1.0 / 15, let data = buffer.floatChannelData else { return }
    lastLevel = now
    let n = Int(buffer.frameLength)
    guard n > 0 else { return }
    var sum: Float = 0
    for i in 0..<n { sum += data[0][i] * data[0][i] }
    let db = 20 * log10(max(sqrt(sum / Float(n)), 1e-6))
    let value = max(0, min(1, (db + 55) / 50))
    emit(["type": "level", "value": Double((value * 100).rounded() / 100)])
  }

  func stop() {
    guard !stopping else { return }
    stopping = true
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    request.endAudio()
    // A recogniser that never answers the end of audio must not hold the
    // composer hostage.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.finish() }
  }

  func cancel() -> Never {
    task?.cancel()
    engine.stop()
    exit(0)
  }

  func finish() {
    guard !finished else { return }
    finished = true
    emit(["type": "final", "text": latest])
    exit(0)
  }
}

// MARK: - Main

if ProcessInfo.processInfo.environment["LYZN_DICTATE_DISCLAIMED"] != "1" {
  relaunchDisclaimed()
}

var args: [String: String] = [:]
var it = CommandLine.arguments.dropFirst().makeIterator()
while let a = it.next() {
  if a.hasPrefix("--"), let v = it.next() { args[String(a.dropFirst(2))] = v }
}

let locale = args["locale"].map { Locale(identifier: $0) } ?? Locale.current
var dictation: Dictation?

func begin() {
  guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
    fail("unavailable", "Speech recognition is not available for this language on this Mac.", status: 3)
  }
  let d = Dictation(recognizer: recognizer)
  dictation = d
  d.start()

  DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
      let command = line.trimmingCharacters(in: .whitespaces)
      if command == "cancel" { DispatchQueue.main.async { d.cancel() } }
      if command == "stop" { DispatchQueue.main.async { d.stop() } }
    }
    DispatchQueue.main.async { d.stop() }
  }
}

SFSpeechRecognizer.requestAuthorization { status in
  guard status == .authorized else {
    fail("speech-denied", "Speech Recognition is turned off for LYZN Dictation in System Settings.", status: 2)
  }
  AVCaptureDevice.requestAccess(for: .audio) { granted in
    guard granted else {
      fail("mic-denied", "The microphone is turned off for LYZN Dictation in System Settings.", status: 2)
    }
    DispatchQueue.main.async { begin() }
  }
}

dispatchMain()
