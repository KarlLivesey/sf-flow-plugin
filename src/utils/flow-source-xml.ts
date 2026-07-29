/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowSourceInvalid } from '../errors/flow-errors.js';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const XML_ENCODING_PATTERN = /^\uFEFF?\s*<\?xml\b[^?]*\bencoding\s*=\s*(['"])([^'"]+)\1[^?]*\?>/iu;

function protectedSectionEnd(content: string, declaration: number): number | null {
  const delimiter = content.startsWith('<!--', declaration)
    ? '-->'
    : content.startsWith('<![CDATA[', declaration)
    ? ']]>'
    : null;
  if (delimiter === null) {
    return null;
  }
  const end = content.indexOf(delimiter, declaration + 4);
  return end < 0 ? content.length : end + delimiter.length;
}

function forbiddenDeclarationAt(content: string, declaration: number): boolean {
  const keyword = /^<!\s*([A-Z]+)/iu.exec(content.slice(declaration))?.[1]?.toUpperCase();
  return keyword === 'DOCTYPE' || keyword === 'ENTITY';
}

export function containsForbiddenXmlDeclaration(content: string): boolean {
  let cursor = 0;
  while (cursor < content.length) {
    const declaration = content.indexOf('<!', cursor);
    if (declaration < 0) {
      return false;
    }
    const protectedEnd = protectedSectionEnd(content, declaration);
    if (protectedEnd === null && forbiddenDeclarationAt(content, declaration)) {
      return true;
    }
    cursor = protectedEnd ?? declaration + 2;
  }
  return false;
}

export function decodeFlowSource(buffer: Uint8Array, sourceFile: string): string {
  let content: string;
  try {
    content = UTF8_DECODER.decode(buffer);
  } catch (error: unknown) {
    throw flowSourceInvalid(`Flow source file "${sourceFile}" is not valid UTF-8.`, error);
  }
  const encoding = XML_ENCODING_PATTERN.exec(content)?.[2];
  if (encoding !== undefined && encoding.toLowerCase() !== 'utf-8') {
    throw flowSourceInvalid(
      `Flow source file "${sourceFile}" declares unsupported XML encoding "${encoding}"; use UTF-8.`
    );
  }
  return content;
}
