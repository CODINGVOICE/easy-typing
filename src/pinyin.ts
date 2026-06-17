const TONE_LETTER_MAP: Record<string, string> = {
  ā: "a",
  á: "a",
  ǎ: "a",
  à: "a",
  ē: "e",
  é: "e",
  ě: "e",
  è: "e",
  ī: "i",
  í: "i",
  ǐ: "i",
  ì: "i",
  ō: "o",
  ó: "o",
  ǒ: "o",
  ò: "o",
  ū: "u",
  ú: "u",
  ǔ: "u",
  ù: "u",
  ǖ: "v",
  ǘ: "v",
  ǚ: "v",
  ǜ: "v",
  ü: "v"
};

export const stripToneMarks = (value: string): string =>
  value
    .split("")
    .map((char) => TONE_LETTER_MAP[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const normalizePinyin = (value: string): string =>
  stripToneMarks(value)
    .toLowerCase()
    .replace(/[ü]/g, "v")
    .replace(/[^a-z0-9]/g, "");

export const plainPinyin = (value: string): string =>
  stripToneMarks(value)
    .toLowerCase()
    .replace(/[ü]/g, "v")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
