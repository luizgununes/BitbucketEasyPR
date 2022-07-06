import * as os from "os";

export function getRunCommand(url: string): string {
  const platform = os.platform();
  if (platform === "darwin") {
    return `open ${url}`;
  }
  if (platform === "win32") {
    return `start "" "${url}"`;
  }

  return `xdg-open ${url}`;
}
