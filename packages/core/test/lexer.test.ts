import { describe, expect, it } from 'vitest';
import { lex, LineIndex } from '../src/scanner/lexer';
import { findClose, parseObject, readCallArgs, receiverBefore } from '../src/scanner/syntax';

describe('lexer', () => {
  it('blanks comments but keeps strings and line numbers', () => {
    const src = "a(); // flagsmith.trackEvent('x')\n/* identify(1)\n */ b('// not a comment');";
    const { code, skeleton } = lex(src);
    expect(code.length).toBe(src.length);
    expect(code).not.toContain('trackEvent');
    expect(code).toContain("'// not a comment'");
    expect(code.split('\n').length).toBe(3);
    expect(skeleton).toContain("b('");
    expect(skeleton).not.toContain('not a comment');
  });

  it('handles template literals with nested expressions', () => {
    const src = 'const s = `a ${fn({ x: "}" })} b`; // gone\nkeep();';
    const { code } = lex(src);
    expect(code).not.toContain('gone');
    expect(code).toContain('keep();');
  });

  it('does not treat division or JSX closing tags as regex', () => {
    const src = 'const r = a / b; // c1\nconst el = <div>x</div>; // c2\nconst re = /ab\\/c/.test(s); // c3';
    const { code } = lex(src);
    expect(code).not.toMatch(/c1|c2|c3/);
  });

  it('maps offsets to lines', () => {
    const idx = new LineIndex('one\ntwo\r\nthree');
    expect(idx.lineOf(0)).toBe(1);
    expect(idx.lineOf(5)).toBe(2);
    expect(idx.lineText(2)).toBe('two');
    expect(idx.lineText(3)).toBe('three');
  });
});

describe('syntax helpers', () => {
  it('splits call arguments at the top level only', () => {
    const src = "track('purchase', { identifier: user.id, value: f(1, 2) })";
    const { skeleton } = lex(src);
    const call = readCallArgs(skeleton, src.indexOf('('))!;
    expect(call.args.map((a) => src.slice(a.start, a.end).trim())).toEqual(["'purchase'", '{ identifier: user.id, value: f(1, 2) }']);
    expect(findClose(skeleton, src.indexOf('('))).toBe(src.length - 1);
  });

  it('parses object literal properties', () => {
    const src = "x({ environmentID: 'k', enableEvents: true, eventProcessorConfig: { eventsApiUrl: 'http://h/api/' }, identity })";
    const { code, skeleton } = lex(src);
    const obj = parseObject(code, skeleton, src.indexOf('{'))!;
    expect(obj.props.map((p) => p.key)).toEqual(['environmentID', 'enableEvents', 'eventProcessorConfig', 'identity']);
    expect(obj.props[1]!.value).toBe('true');
    expect(obj.props[3]!.shorthand).toBe(true);
  });

  it('reads the receiver of a method call', () => {
    const src = 'await this.flagsmith?.identify(id)';
    const { skeleton } = lex(src);
    const dot = src.indexOf('.identify');
    expect(receiverBefore(skeleton, dot)).toEqual({ text: 'this.flagsmith', start: src.indexOf('this') });
  });
});
