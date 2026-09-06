/** Event descriptions are not player identities. Keep this repair deliberately narrow. */
export function playerName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFC")
    .replace(/^\s*(?:assist(?:ed)?\s+by\s*:?|assist\s*:)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function shortPlayerName(value: string): string {
  const name = playerName(value);
  if (name.length <= 16) return name;
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}
