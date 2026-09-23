import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const entrySource = await readFile(new URL("../lib/student-entry-client.ts", import.meta.url), "utf8");
const executableJavaScript = ts.transpileModule(entrySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const entryClient = await import(`data:text/javascript;base64,${Buffer.from(executableJavaScript).toString("base64")}`);
const { classifyEntryError } = entryClient;

const join = (await readFile(new URL("../app/components/JoinClient.tsx", import.meta.url), "utf8")).replace(
  /\r\n/g,
  "\n",
);

test("a wrong class code or participation code is classified for teacher-call recovery, everything else is general", () => {
  assert.equal(classifyEntryError(404), "code");
  assert.equal(classifyEntryError(401), "general");
  assert.equal(classifyEntryError(409), "general");
  assert.equal(classifyEntryError(429), "general");
  assert.equal(classifyEntryError(500), "general");
});

test("errors are shown with a warning picture", () => {
  assert.match(join, /className="error-box child-error" role="alert"/);
  assert.match(join, /child-error-icon" aria-hidden="true">⚠️/);
  assert.doesNotMatch(join, /SpeakButton/);
});

test("the first correction clears the previous error — every key press, erase and animal pick", () => {
  assert.match(join, /const pressKey = \(digit: string\) => \{ clearEntryError\(\);/);
  assert.match(join, /onClick=\{\(\) => \{ clearEntryError\(\); setCodeInput\(\(current\) => current\.slice\(0, -1\)\); \}\}/);
  assert.match(join, /setAnimal\(character\.emoji\); clearEntryError\(\);/);
});

test("a wrong code offers calling the teacher (there is no visible class-code field — it comes from the landing page or QR)", () => {
  // 2026-09-21 잠금이 생기며 조건에 "locked"가 더해졌다. 지키려는 뜻은 그대로다 —
  // 코드가 틀렸을 때(그리고 잠겼을 때도) 아이가 선생님을 부를 길이 있어야 한다.
  assert.match(join, /\(errorKind === "code" \|\| errorKind === "locked"\) && !teacherCallOpen/);
  assert.match(join, /🙋<\/span>선생님 불러요/);
  assert.match(join, /손을 들고 선생님을 불러요\./);
  assert.match(join, /참여 코드를 다시 알려 주실 거예요\./);
});

test("the code screen submits only four digits and the animal screen only after a pick", () => {
  assert.match(join, /export const ENTRY_CODE_LENGTH = 4;/);
  // 2026-09-22 잠금이 생기며 waiting 조건이 앞에 붙었다. 뜻은 그대로다 — 네 자리가 아니면 못 보낸다.
  assert.match(join, /disabled=\{waiting \|\| busy \|\| codeInput\.length !== ENTRY_CODE_LENGTH\}/);
  assert.match(join, /disabled=\{busy \|\| !chosen\}/);
  assert.match(join, /autoComplete="one-time-code"/);
});

test("animal buttons carry Korean names for assistive tech", () => {
  // 친구 이름과 동물 이름을 함께 읽어 준다("솔이, 토끼"). 이름 목록은 lib/animal-characters.ts 한곳이다.
  assert.match(join, /aria-label=\{`\$\{character\.name\}, \$\{character\.species\}`\}/);
  assert.match(join, /import \{ ANIMAL_CHARACTERS, withGwaWa \} from "@\/lib\/animal-characters";/);
});
