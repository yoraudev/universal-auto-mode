export const CHOICES = {
  model: {
    title: "Model",
    category: "Classifier",
    description: "Which classifier scans tool output",
    options: [
      { value: "base", title: "base", description: "308M parameters. More accurate, 641 MB download" },
      { value: "small", title: "small", description: "141M parameters. About twice as fast, 268 MB download" },
    ],
  },
  device: {
    title: "Device",
    category: "Classifier",
    description: "Where the classifier runs",
    options: [
      { value: "cpu", title: "cpu", description: "Default. Steady speed at every input length" },
      { value: "gpu", title: "gpu", description: "Fastest GPU provider found. Slow on the first scan at each length" },
      { value: "dml", title: "dml", description: "DirectML. Windows, any DirectX 12 GPU" },
      { value: "webgpu", title: "webgpu", description: "WebGPU. Direct3D 12, Vulkan or Metal" },
      { value: "cuda", title: "cuda", description: "NVIDIA on Linux x64. Untested" },
      { value: "coreml", title: "coreml", description: "macOS. Untested" },
    ],
  },
  detection: {
    title: "On detection",
    category: "Detection",
    description: "What happens when an output is flagged as an injection",
    options: [
      { value: "warn", title: "warn", description: "Default. The agent is warned and keeps working, nothing is asked" },
      { value: "ask", title: "ask", description: "You are asked to continue or stop, and riskier actions go to you" },
    ],
  },
  notifications: {
    title: "Notifications",
    category: "Detection",
    description: "Whether you get a notice when an output is flagged and the agent is warned",
    options: [
      { value: "on", title: "on", description: "Default. A notice names each flagged output" },
      { value: "off", title: "off", description: "No notice for flags. The agent is still warned, and questions still appear" },
    ],
  },
  unscanned: {
    title: "Unscanned output",
    category: "Detection",
    description: "Ask mode: what happens after an output that could not be scanned in full",
    options: [
      { value: "allow", title: "allow", description: "Default. You get a notice and nothing else changes" },
      { value: "ask", title: "ask", description: "High-risk actions are sent to you until you clear the session's flags" },
    ],
  },
}

export const NUMBERS = {
  weak: { title: "Flag threshold", category: "Thresholds", description: "Outputs scoring this or more are flagged (0 to 1)", help: "Outputs scoring this or more are flagged. In ask mode, high-risk actions are sent to you from this session score. 0 to 1." },
  strong: { title: "Ask threshold", category: "Thresholds", description: "Ask mode: you are asked from this score (0 to 1)", help: "Only used in ask mode. You are asked about outputs scoring this or more, and medium-risk actions are sent to you from this session score. 0 to 1." },
  window: { title: "Window", category: "Scanning", description: "Tokens per classifier window", help: "Tokens per classifier window. Smaller windows find short injections in long outputs more reliably but take longer in total." },
  overlap: { title: "Overlap", category: "Scanning", description: "Tokens shared by neighboring windows", help: "Tokens shared by neighboring windows, so an injection on a window border is not cut in half." },
  scanBudgetMs: { title: "Scan budget", category: "Scanning", description: "Milliseconds a scan may hold up a tool result", help: "Milliseconds a tool result may wait for its scan. A scan that takes longer continues in the background, and its output reaches the agent without a warning." },
  decideWaitMs: { title: "Decision wait", category: "Scanning", description: "Ask mode: milliseconds to wait for running scans", help: "Only used in ask mode. Milliseconds a permission decision waits for scans that are still running." },
  maxChars: { title: "Scan limit", category: "Scanning", description: "Longest tool output, in characters, scanned in full", help: "Longest tool output, in characters, that is scanned in full. Of a longer output, the first and the last half of this many characters are scanned and the middle is not." },
  unloadMinutes: { title: "Unload after", category: "Classifier", description: "Idle minutes before the classifier leaves memory (0 for never)", help: "Minutes without a scan after which the classifier is unloaded to free memory. It is loaded again by the next scan, which then takes a few seconds longer. 0 keeps it loaded." },
}

export const RELOADS = new Set(["model", "device", "window", "overlap", "maxChars"])
const megabytes = (bytes) => Math.round(bytes / 1e6)

export const isBusy = (status) => status?.state === "downloading" || status?.state === "loading"

export function statusLine(status) {
  if (status?.state === "downloading") return `Downloading ${status.model}: ${status.percent ?? "?"}% (${megabytes(status.received)} of ${megabytes(status.total)} MB)`
  if (status?.state === "loading") return `Loading ${status.model}…`
  if (status?.state === "error") return "The classifier could not be loaded"
  if (status?.state === "idle") return "The classifier is unloaded and loads again on the next scan"
  return "The classifier is ready"
}
