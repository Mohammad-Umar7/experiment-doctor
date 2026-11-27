/**
 * A small JS/TS lexer that is just good enough for static evidence:
 * it blanks comments (keeping every newline so offsets and line numbers stay
 * valid) and can also blank string contents, so call sites are never matched
 * inside text.
 */

type Mode = 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' | 'regex';

const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|void|yield|await)\s*$/;

export interface Lexed {
  /** Source with comments replaced by spaces. Strings kept. */
  code: string;
  /** Source with comments AND string/template/regex contents replaced by spaces (quotes kept). */
  skeleton: string;
}

export function lex(src: string): Lexed {
  const code = src.split('');
  const skel = src.split('');
  const n = src.length;
  const modes: Mode[] = ['code'];
  // For each open template expression, the brace depth where it started.
  const tplBraces: number[] = [];
  let depth = 0;
  let last = '';
  let lastWordTail = '';

  const blank = (arr: string[], i: number) => {
    if (arr[i] !== '\n' && arr[i] !== '\r') arr[i] = ' ';
  };

  for (let i = 0; i < n; i++) {
    const c = src[i]!;
    const next = src[i + 1];
    const mode = modes[modes.length - 1]!;

    switch (mode) {
      case 'line':
        if (c === '\n') modes.pop();
        else {
          blank(code, i);
          blank(skel, i);
        }
        continue;
      case 'block':
        if (c === '*' && next === '/') {
          blank(code, i);
          blank(skel, i);
          blank(code, i + 1);
          blank(skel, i + 1);
          i++;
          modes.pop();
        } else {
          blank(code, i);
          blank(skel, i);
        }
        continue;
      case 'sq':
      case 'dq': {
        const q = mode === 'sq' ? "'" : '"';
        if (c === '\\') {
          blank(skel, i);
          if (i + 1 < n) blank(skel, i + 1);
          i++;
        } else if (c === q) {
          modes.pop();
          last = q;
        } else if (c === '\n') {
          modes.pop(); // unterminated: strings cannot span lines
        } else blank(skel, i);
        continue;
      }
      case 'regex':
        if (c === '\\') {
          blank(skel, i);
          if (i + 1 < n) blank(skel, i + 1);
          i++;
        } else if (c === '[') {
          // character class: '/' does not end the regex here
          blank(skel, i);
          let j = i + 1;
          while (j < n && src[j] !== ']' && src[j] !== '\n') {
            if (src[j] === '\\') {
              blank(skel, j);
              j++;
            }
            blank(skel, j);
            j++;
          }
          i = j;
        } else if (c === '/' || c === '\n') {
          modes.pop();
          last = '/';
        } else blank(skel, i);
        continue;
      case 'tpl':
        if (c === '\\') {
          blank(skel, i);
          if (i + 1 < n) blank(skel, i + 1);
          i++;
        } else if (c === '`') {
          modes.pop();
          last = '`';
        } else if (c === '$' && next === '{') {
          tplBraces.push(depth);
          depth++;
          modes.push('code');
          i++;
          last = '{';
        } else blank(skel, i);
        continue;
      case 'code':
      default:
        break;
    }

    // code mode
    if (c === '/' && next === '/') {
      modes.push('line');
      blank(code, i);
      blank(skel, i);
      continue;
    }
    if (c === '/' && next === '*') {
      modes.push('block');
      blank(code, i);
      blank(skel, i);
      continue;
    }
    if (c === "'") {
      modes.push('sq');
      continue;
    }
    if (c === '"') {
      modes.push('dq');
      continue;
    }
    if (c === '`') {
      modes.push('tpl');
      continue;
    }
    if (c === '/') {
      if (REGEX_PRECEDERS.has(last) || REGEX_KEYWORDS.test(lastWordTail)) {
        modes.push('regex');
        continue;
      }
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (tplBraces.length && tplBraces[tplBraces.length - 1] === depth) {
        tplBraces.pop();
        modes.pop(); // back to template text
        continue;
      }
    }
    if (!/\s/.test(c)) {
      last = /[\w$]/.test(c) ? 'w' : c;
      lastWordTail = (lastWordTail + c).slice(-12);
    } else {
      lastWordTail += ' ';
      lastWordTail = lastWordTail.slice(-12);
    }
  }
  return { code: code.join(''), skeleton: skel.join('') };
}

/** Maps string offsets to 1-based line numbers. */
export class LineIndex {
  private starts: number[] = [0];
  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.starts.push(i + 1);
  }
  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  /** Exact text of a 1-based line, without the line break. */
  lineText(line: number): string {
    const start = this.starts[line - 1];
    if (start === undefined) return '';
    const end = this.starts[line] ?? this.text.length + 1;
    return this.text.slice(start, end - 1).replace(/\r$/, '');
  }
  get lineCount(): number {
    return this.starts.length;
  }
}
