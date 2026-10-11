/**
 * 优化二 main.js —— 行为验证脚本（最小 DOM 桩 + 假计时器）
 * 运行：node "优化二/_verify/dom.test.mjs"
 *
 * 覆盖点：
 *  1. 题目状态与计时器管理（同题不重复出题、计时器只有一个句柄）
 *  2. 答对后禁用输入，重复提交不重复计分
 *  3. 过期回调校验（换题后旧的自动出题回调必须被丢弃）
 *  4. 空答案 / 非法数值分别提示
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcPath = join(here, '..', 'main.js')
const tmpPath = join(here, '.main-under-test.mjs')

/* ------------------------------ 断言工具 ------------------------------ */
let pass = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name} → 期望 ${e}，实际 ${a}`)
    console.log(`  ✗ ${name} → 期望 ${e}，实际 ${a}`)
  }
}

/* ------------------------------ DOM 桩 ------------------------------ */
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag
    this.textContent = ''
    this.className = ''
    this.value = ''
    this.disabled = false
    this.validity = { badInput: false }
    this.attributes = {}
    this.listeners = {}
    this.querySelectorMap = {}
    this.focusCount = 0
    this.selectCount = 0
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  dispatch(type) {
    let prevented = false
    const event = { preventDefault: () => (prevented = true) }
    for (const fn of this.listeners[type] || []) fn(event)
    return prevented
  }
  querySelector(sel) {
    return this.querySelectorMap[sel] ?? null
  }
  focus() {
    this.focusCount += 1
  }
  select() {
    this.selectCount += 1
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value)
  }
  removeAttribute(key) {
    delete this.attributes[key]
  }
  getAttribute(key) {
    return key in this.attributes ? this.attributes[key] : null
  }
}

const el = {
  app: new FakeElement('div'),
  question: new FakeElement('section'),
  answer: new FakeElement('input'),
  form: new FakeElement('form'),
  message: new FakeElement('p'),
  score: new FakeElement('span'),
  streak: new FakeElement('span'),
  newGame: new FakeElement('button'),
  submit: new FakeElement('button'),
}
el.form.querySelectorMap['button[type="submit"]'] = el.submit

const selectorMap = {
  '#app': el.app,
  '#question': el.question,
  '#answer': el.answer,
  '#answer-form': el.form,
  '#message': el.message,
  '#score': el.score,
  '#streak': el.streak,
  '#new-game': el.newGame,
}

globalThis.document = {
  querySelector: (sel) => selectorMap[sel] ?? null,
}

/* --------------------------- 假计时器 --------------------------- */
const pendingTimers = new Map()
const timerHistory = [] // 保留所有被调度过的回调，用来手动触发“过期回调”
let timerSeq = 0
globalThis.window = {
  setTimeout(fn, ms) {
    timerSeq += 1
    pendingTimers.set(timerSeq, { fn, ms })
    timerHistory.push(fn)
    return timerSeq
  },
  clearTimeout(id) {
    pendingTimers.delete(id)
  },
}
function runTimers() {
  const due = [...pendingTimers.entries()]
  pendingTimers.clear()
  for (const [, timer] of due) timer.fn()
}

/* --------------------------- 固定随机数 --------------------------- */
let randomCalls = 0
const randQueue = [0, 0, 0.5, 0.5, 0.9, 0.9, 0.2, 0.2, 0.7, 0.7, 0.4, 0.4]
Math.random = () => {
  randomCalls += 1
  return randQueue.length ? randQueue.shift() : 0
}
const questionCount = () => randomCalls / 2

/* --------------------------- 载入被测模块 --------------------------- */
const source = readFileSync(srcPath, 'utf8').replace(/^\s*import\s+['"]\.\/style\.css['"]\s*$/m, '')
writeFileSync(tmpPath, source, 'utf8')
await import(pathToFileURL(tmpPath).href)
unlinkSync(tmpPath)

/* --------------------------- 便捷操作 --------------------------- */
const submit = (value, { badInput = false } = {}) => {
  el.answer.value = value
  el.answer.validity.badInput = badInput
  el.form.dispatch('submit')
  el.answer.validity.badInput = false
}
const snapshot = () => ({
  score: el.score.textContent,
  streak: el.streak.textContent,
  disabled: el.answer.disabled,
  submitDisabled: el.submit.disabled,
  message: el.message.textContent,
  tone: el.message.className,
  question: el.question.textContent,
})

console.log('\n[1] 初始状态与出题')
check('第一题题面', el.question.textContent, '1 + 1 = ?')
check('初始分数/连续', [el.score.textContent, el.streak.textContent], [0, 0])
check('输入框可作答', [el.answer.disabled, el.submit.disabled], [false, false])
check('只生成了一道题', questionCount(), 1)

console.log('\n[2] 空答案提示（不锁定、不计分）')
submit('')
check('空答案提示文案', el.message.textContent, '先写下答案再提交哦！')
check('提示样式为 try', el.message.className, 'message try')
check('标记 aria-invalid', el.answer.getAttribute('aria-invalid'), 'true')
check('分数未变化', [el.score.textContent, el.streak.textContent], [0, 0])
check('仍可继续作答', [el.answer.disabled, el.submit.disabled], [false, false])

console.log('\n[3] 非法数值提示（不锁定、不计分）')
submit('', { badInput: true })
check('badInput 判为非法', el.message.textContent, '请输入 0～999999 的整数答案哦！')
submit('-3')
check('负数判为非法', el.message.textContent, '请输入 0～999999 的整数答案哦！')
submit('1.5')
check('小数判为非法', el.message.textContent, '请输入 0～999999 的整数答案哦！')
submit('1e3')
check('科学计数法判为非法', el.message.textContent, '请输入 0～999999 的整数答案哦！')
submit('1234567')
check('超长数字判为非法', el.message.textContent, '请输入 0～999999 的整数答案哦！')
submit('abc')
check('字母判为非法', el.message.textContent, '请输入 0～999999 的整数答案哦！')
check('非法输入不计分、不重置连续', [el.score.textContent, el.streak.textContent], [0, 0])

console.log('\n[4] 答对：禁用输入 + 防重复计分')
submit('2')
check('答对提示', el.message.textContent, '答对啦！你真聪明！🎉')
check('答对样式为 good', el.message.className, 'message good')
check('计分 +1', [el.score.textContent, el.streak.textContent], [1, 1])
check('输入框已禁用', el.answer.disabled, true)
check('提交按钮已禁用', el.submit.disabled, true)
check('挂起 1 个自动出题计时器', pendingTimers.size, 1)

submit('2') // 锁定阶段的重复提交
check('重复提交不重复计分', [el.score.textContent, el.streak.textContent], [1, 1])
check('重复提交不再排队计时器', pendingTimers.size, 1)
check('重复提交不出新题', questionCount(), 1)

console.log('\n[5] 自动出下一题')
runTimers()
check('自动出题后题面更新', el.question.textContent, '6 + 6 = ?')
check('题号已推进（共 2 题）', questionCount(), 2)
check('输入重新可用', [el.answer.disabled, el.submit.disabled], [false, false])
check('计时器句柄已释放', pendingTimers.size, 0)

console.log('\n[6] 答错：重置连续但保持可作答')
submit('99')
check('答错提示', el.message.textContent, '再想一想，你一定可以的！💪')
check('连续归零、总分保留', [el.score.textContent, el.streak.textContent], [1, 0])
check('答错后仍可作答', [el.answer.disabled, el.submit.disabled], [false, false])
check('答错不排队自动出题', pendingTimers.size, 0)

console.log('\n[7] 答对后换题：过期回调必须被丢弃')
submit('12')
check('第二题答对计分', [el.score.textContent, el.streak.textContent], [2, 1])
check('锁定并排队计时器', [el.answer.disabled, pendingTimers.size], [true, 1])
const staleCallback = timerHistory[timerHistory.length - 1]
el.newGame.dispatch('click')
check('换题后题面更新', el.question.textContent, '10 + 10 = ?')
check('换题清掉了挂起的计时器', pendingTimers.size, 0)
check('换题后共 3 题', questionCount(), 3)
staleCallback() // 手动执行“已被清掉”的旧回调，模拟计时器竞态
check('过期回调未额外出题', questionCount(), 3)
check('过期回调未破坏题面', el.question.textContent, '10 + 10 = ?')
runTimers()
check('清空计时器后无残留回调', questionCount(), 3)
check('换题后输入可用', [el.answer.disabled, el.submit.disabled], [false, false])

console.log('\n[8] 锁定阶段直接换题：不产生重复出题')
submit('20')
check('第三题答对计分', [el.score.textContent, el.streak.textContent], [3, 2])
el.newGame.dispatch('click')
check('锁定中换题也清掉计时器', pendingTimers.size, 0)
check('锁定中换题共 4 题', questionCount(), 4)
runTimers()
check('残留回调再次被丢弃', questionCount(), 4)

console.log('\n[9] 全角数字归一化')
submit('１１') // 当前题为 3 + 3 = 6，全角 １１ 应归一化为 11（答错）而非非法
check('全角数字按数值处理', el.message.textContent, '再想一想，你一定可以的！💪')

/* ------------------------------ 汇总 ------------------------------ */
console.log(`\n结果：${pass} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
