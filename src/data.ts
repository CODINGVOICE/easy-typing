import {
  GB2312_ALL,
  GB2312_TOTAL_COUNT,
  type Gb2312Record
} from "./gb2312";
import {
  GRADE_CHARACTER_GROUPS,
  SIMPLE_GRADE_LEVELS,
  type GradeLevel,
  type SimpleGradeLevel
} from "./gradeCharacters";

export type LessonStage = "keyboard" | "game" | "simple" | "complex";

export type PracticeKind = "key" | "pinyin";

export interface StageMeta {
  id: LessonStage;
  title: string;
  shortTitle: string;
}

export interface LessonItem {
  id: string;
  kind: PracticeKind;
  text: string;
  pinyin?: string[];
  answer: string;
  keys: string[];
  tip: string;
  focus: string;
}

export interface Lesson {
  id: string;
  stage: LessonStage;
  title: string;
  goal: string;
  random?: boolean;
  items: LessonItem[];
}

export const STAGES: StageMeta[] = [
  { id: "keyboard", title: "熟悉键盘", shortTitle: "键盘" },
  { id: "game", title: "打字游戏", shortTitle: "游戏" },
  { id: "simple", title: "简单拼音", shortTitle: "简单" },
  { id: "complex", title: "复杂拼音", shortTitle: "复杂" }
];

export interface KeyboardRow {
  id: string;
  keys: string[];
}

const DIGIT_KEYS = "1234567890".split("");
const SYMBOL_KEYS = ["`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/"];
const LETTER_KEYS = "abcdefghijklmnopqrstuvwxyz".split("");

export const KEYBOARD_ROWS: KeyboardRow[] = [
  { id: "numbers", keys: ["`", ...DIGIT_KEYS, "-", "="] },
  { id: "top", keys: [..."qwertyuiop".split(""), "[", "]", "\\"] },
  { id: "home", keys: [..."asdfghjkl".split(""), ";", "'"] },
  { id: "bottom", keys: [..."zxcvbnm".split(""), ",", ".", "/"] }
];

export const GAME_KEYS = [...LETTER_KEYS, ...DIGIT_KEYS, ...SYMBOL_KEYS];
const ALL_KEYBOARD_KEYS = GAME_KEYS;

const keyLabel = (key: string): string => (/[a-z]/.test(key) ? key.toUpperCase() : key);

const keyId = (key: string): string =>
  key.codePointAt(0)?.toString(16) ?? "unknown";

const keyFocus = (key: string): string => {
  if (/[a-z]/.test(key)) {
    return `字母键 ${key.toUpperCase()}`;
  }

  if (/\d/.test(key)) {
    return `数字键 ${key}`;
  }

  return `符号键 ${key}`;
};

const keyTip = (key: string): string => {
  if (/[a-z]/.test(key)) {
    return "看高亮字母键，先按准，再继续。";
  }

  if (/\d/.test(key)) {
    return "数字键在字母键上方一排，先找位置再按。";
  }

  return "符号键靠近键盘边缘和右侧区域，慢慢看形状。";
};

const keyItem = (
  key: string,
  focus = keyFocus(key),
  tip = keyTip(key)
): LessonItem => ({
  id: `key-${keyId(key)}`,
  kind: "key",
  text: keyLabel(key),
  answer: key,
  keys: [key],
  tip,
  focus
});

const keyItems = (keys: string[]): LessonItem[] => keys.map((key) => keyItem(key));

const INITIALS = [
  "zh",
  "ch",
  "sh",
  "b",
  "p",
  "m",
  "f",
  "d",
  "t",
  "n",
  "l",
  "g",
  "k",
  "h",
  "j",
  "q",
  "x",
  "r",
  "z",
  "c",
  "s",
  "y",
  "w"
];

const ZERO_INITIAL_SYLLABLES = new Set([
  "a",
  "ai",
  "an",
  "ang",
  "ao",
  "e",
  "ei",
  "en",
  "eng",
  "er",
  "m",
  "ng",
  "o",
  "ou"
]);

const splitSyllable = (answer: string): [string, string] => {
  if (ZERO_INITIAL_SYLLABLES.has(answer)) {
    return ["", answer];
  }

  const initial = INITIALS.find((candidate) => answer.startsWith(candidate));

  return initial ? [initial, answer.slice(initial.length)] : ["", answer];
};

const focusForPinyin = (answer: string): string => {
  const [initial, final] = splitSyllable(answer);

  return initial ? `${initial} + ${final}` : `零声母 + ${final}`;
};

const tipForPinyin = (answer: string): string => {
  if (answer.includes("v")) {
    return "这个拼音里有 ü，键盘输入时用 v。";
  }

  if (/^(zh|ch|sh)/.test(answer)) {
    return "zh、ch、sh 是两个字母组成的声母。";
  }

  if (/(ang|eng|ing|ong)$/.test(answer)) {
    return "这个字有后鼻音韵母，结尾要按到 g。";
  }

  if (answer.length >= 4) {
    return "先把拼音拆成声母和韵母，再一个字母一个字母按。";
  }

  return "先看汉字上方的注音，再按准拼音字母。";
};

const gb2312Item = (
  [char, markedPinyin, answer]: Gb2312Record,
  index: number,
  group: string
): LessonItem => ({
  id: `gb2312-${group}-${index}-${char.codePointAt(0)?.toString(16) ?? "x"}`,
  kind: "pinyin",
  text: char,
  pinyin: [markedPinyin],
  answer,
  keys: answer.split(""),
  focus: focusForPinyin(answer),
  tip: tipForPinyin(answer)
});

const gb2312Items = (
  records: readonly Gb2312Record[],
  group: string
): LessonItem[] =>
  records.map((record, index) => gb2312Item(record, index, group));

const simpleGradeSet = new Set<GradeLevel>(SIMPLE_GRADE_LEVELS);

const isSimpleGradeLevel = (grade: GradeLevel): grade is SimpleGradeLevel =>
  simpleGradeSet.has(grade);

const gradeByChar = new Map<string, GradeLevel>();

GRADE_CHARACTER_GROUPS.forEach((group) => {
  Array.from(group.chars).forEach((char) => {
    if (!gradeByChar.has(char)) {
      gradeByChar.set(char, group.grade);
    }
  });
});

type SimpleGradeCharacterGroup = {
  grade: SimpleGradeLevel;
  title: string;
  chars: string;
};

const simpleGradeGroups = GRADE_CHARACTER_GROUPS.filter(
  (group): group is SimpleGradeCharacterGroup => isSimpleGradeLevel(group.grade)
);

const gb2312RecordsBySimpleGrade = new Map<SimpleGradeLevel, Gb2312Record[]>(
  SIMPLE_GRADE_LEVELS.map((grade) => [grade, []])
);
const complexGb2312Records: Gb2312Record[] = [];

GB2312_ALL.forEach((record) => {
  const grade = gradeByChar.get(record[0]);

  if (grade && isSimpleGradeLevel(grade)) {
    gb2312RecordsBySimpleGrade.get(grade)?.push(record);
    return;
  }

  complexGb2312Records.push(record);
});

const gradeLessons: Lesson[] = simpleGradeGroups.map((group) => {
  const records = gb2312RecordsBySimpleGrade.get(group.grade) ?? [];

  return {
    id: `grade-${group.grade}`,
    stage: "simple",
    title: `${group.title}汉字`,
    goal: `${records.length}/${GB2312_TOTAL_COUNT} 字`,
    random: true,
    items: gb2312Items(records, `grade-${group.grade}`)
  };
});

export const LESSONS: Lesson[] = [
  {
    id: "keyboard-random",
    stage: "keyboard",
    title: "全部随机",
    goal: "字母 数字 符号",
    random: true,
    items: keyItems(ALL_KEYBOARD_KEYS)
  },
  {
    id: "home-keys",
    stage: "keyboard",
    title: "手指回家",
    goal: "ASDF GH JKL",
    items: [
      keyItem("a", "左手小指"),
      keyItem("s", "左手无名指"),
      keyItem("d", "左手中指"),
      keyItem("f", "左手食指"),
      keyItem("g", "左手食指向内找 G"),
      keyItem("h", "右手食指向内找 H"),
      keyItem("j", "右手食指"),
      keyItem("k", "右手中指"),
      keyItem("l", "右手无名指")
    ]
  },
  {
    id: "vowel-keys",
    stage: "keyboard",
    title: "韵母小路",
    goal: "a o e i u v",
    items: [
      keyItem("a", "张大嘴 a", "拼音 a 常用左手小指。"),
      keyItem("o", "圆圆嘴 o", "右手无名指去找 o。"),
      keyItem("e", "扁扁嘴 e", "左手中指向上找 e。"),
      keyItem("i", "细细音 i", "右手中指向上找 i。"),
      keyItem("u", "合口音 u", "右手食指向上找 u。"),
      keyItem("v", "键盘里的 ü", "拼音输入里常用 v 来打 ü。")
    ]
  },
  {
    id: "initial-keys",
    stage: "keyboard",
    title: "声母脚步",
    goal: "b p m f d t n l",
    items: [
      keyItem("b", "双唇音 b"),
      keyItem("p", "双唇音 p"),
      keyItem("m", "双唇音 m"),
      keyItem("f", "唇齿音 f"),
      keyItem("d", "舌尖音 d"),
      keyItem("t", "舌尖音 t"),
      keyItem("n", "舌尖音 n"),
      keyItem("l", "舌尖音 l")
    ]
  },
  {
    id: "number-keys",
    stage: "keyboard",
    title: "数字阶梯",
    goal: "1 2 3 4 5 6 7 8 9 0",
    items: keyItems(DIGIT_KEYS)
  },
  {
    id: "symbol-keys",
    stage: "keyboard",
    title: "符号小路",
    goal: "` - = [ ] \\ ; ' , . /",
    items: keyItems(SYMBOL_KEYS)
  },
  {
    id: "typing-game",
    stage: "game",
    title: "打字游戏",
    goal: "漏掉 10 个结束",
    items: []
  },
  ...gradeLessons,
  {
    id: "gb2312-ungraded",
    stage: "complex",
    title: "五年级外复杂汉字",
    goal: `${complexGb2312Records.length}/${GB2312_TOTAL_COUNT} 字`,
    random: true,
    items: gb2312Items(complexGb2312Records, "complex")
  }
];
