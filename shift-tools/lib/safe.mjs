// Anything that came from a stranger or from the container goes through here before it's shown in
// a terminal, so escape sequences can't rewrite what you read before you confirm.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

export function safeText(value, max = 400) {
  return String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const SAFE_PATH = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)*$/;

// ASCII only and no ".." parts. A case-folded ".git" anywhere is refused, which also covers the
// ignorable-character tricks that make macOS read a strange name as ".git".
export function isSafePath(path) {
  if (typeof path !== 'string' || path.length > 200 || !SAFE_PATH.test(path)) return false;
  return path.split('/').every((part) => part !== '..' && part !== '.' && part.toLowerCase() !== '.git');
}
