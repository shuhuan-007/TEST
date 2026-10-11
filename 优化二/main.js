import './style.css'

/* ==========================================================================
 * 小小加法家 —— 优化二：src/main.js
 * 1) 题目状态与计时器管理：单一状态对象 + 阶段机，计时器只有一个句柄、集中清理
 * 2) 答对后禁用输入：锁定阶段忽略一切重复提交，防止重复计分
 * 3) 过期回调校验：计时器回调校验「题号 + 阶段」，过期一律丢弃
 * 4) 空答案 / 非法数值提示：空、非法（小数、负数、科学计数法、字母、超长）分别提示
 * ========================================================================== */

const app = document.querySelector('#app')

/* ------------------------------ 常量 ------------------------------ */

// 答对后自动出下一题的延迟（毫秒）
const NEXT_QUESTION_DELAY = 650
// 合法答案只允许「1~6 位纯数字」，超出范围一律视为非法数值
const ANSWER_PATTERN = /^\d{1,6}$/

/* --------------------------- 题目状态 ---------------------------- */
/**
 * 阶段机：
 *   'answering' —— 正在作答，接受提交、可以计分
 *   'locked'    —— 本题已答对并锁定，等待自动出下一题，拒绝任何重复提交
 */
const state = {
  first: 0, // 加数一
  second: 0, // 加数二
  score: 0, // 累计答对数
  streak: 0, // 连续答对数
  questionId: 0, // 题号：每题自增，用于识别过期定时器回调
  phase: 'answering', // 当前阶段
  nextQuestionTimer: null, // 自动出题计时器句柄（同一时刻最多一个）
}

app.innerHTML = `
  <main class="card">
    <div class="star" aria-hidden="true">⭐</div>
    <h1>小小加法家</h1>
    <p class="subtitle">动动脑筋，成为加法小能手！</p>
    <div class="score-row" aria-live="polite">
      <div class="pill">答对：<span id="score">0</span> 题</div>
      <div class="pill blue">连续：<span id="streak">0</span> 题</div>
    </div>
    <section class="question" id="question" aria-label="加法题目"></section>
    <form id="answer-form" novalidate>
      <label class="sr-only" for="answer">你的答案</label>
      <input id="answer" type="number" inputmode="numeric" autocomplete="off" placeholder="写答案" />
      <button type="submit">提交</button>
    </form>
    <p id="message" class="message" aria-live="polite">准备好了吗？</p>
    <button id="new-game" class="new-game" type="button">换一道题</button>
    <p class="hint">小提示：认真算一算，不要着急哦！</p>
  </main>
`

const questionEl = document.querySelector('#question')
const answerEl = document.querySelector('#answer')
const form = document.querySelector('#answer-form')
const messageEl = document.querySelector('#message')
const scoreEl = document.querySelector('#score')
const streakEl = document.querySelector('#streak')
const newGameBtn = document.querySelector('#new-game')
const submitBtn = form.querySelector('button[type="submit"]')

/* --------------------------- 视图渲染 ---------------------------- */

function renderScore() {
  scoreEl.textContent = state.score
  streakEl.textContent = state.streak
}

function showMessage(text, tone) {
  messageEl.textContent = text
  messageEl.className = tone ? `message ${tone}` : 'message'
}

/** 统一开关作答控件：锁定阶段输入框与提交按钮都禁用，避免重复提交 */
function setAnsweringEnabled(enabled) {
  answerEl.disabled = !enabled
  submitBtn.disabled = !enabled
  answerEl.setAttribute('aria-invalid', 'false')
}

/* ------------------------- 计时器管理 ---------------------------- */

/** 清理待执行的自动出题计时器，保证不会残留多个回调 */
function clearNextQuestionTimer() {
  if (state.nextQuestionTimer !== null) {
    window.clearTimeout(state.nextQuestionTimer)
    state.nextQuestionTimer = null
  }
}

/**
 * 安排自动出下一题。
 * @param {number} answeredQuestionId 触发本次计时的题号
 */
function scheduleNextQuestion(answeredQuestionId) {
  clearNextQuestionTimer()
  state.nextQuestionTimer = window.setTimeout(() => {
    state.nextQuestionTimer = null
    // 过期回调校验：玩家已经换题（题号变化）或阶段已不是锁定态，则丢弃本次回调
    if (state.phase !== 'locked' || state.questionId !== answeredQuestionId) return
    newQuestion()
  }, NEXT_QUESTION_DELAY)
}

/* --------------------------- 出题 ------------------------------- */

function newQuestion() {
  clearNextQuestionTimer()

  state.first = Math.floor(Math.random() * 10) + 1
  state.second = Math.floor(Math.random() * 10) + 1
  state.questionId += 1
  state.phase = 'answering'

  questionEl.textContent = `${state.first} + ${state.second} = ?`
  answerEl.value = ''
  setAnsweringEnabled(true)
  answerEl.focus()

  return state.questionId
}

/* ------------------------- 答案解析校验 --------------------------- */

/**
 * 解析并校验输入值。
 * @returns {{ok: true, value: number} | {ok: false, reason: 'empty' | 'invalid'}}
 */
function parseAnswer(inputEl) {
  // 输入框里的内容浏览器认为无法解析（例如 "abc"）时，value 可能是空串
  if (inputEl.validity && inputEl.validity.badInput) return { ok: false, reason: 'invalid' }

  // 全角数字（１２３）先归一化为半角，方便小朋友的输入法
  const text = String(inputEl.value).trim().replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  )

  if (text === '') return { ok: false, reason: 'empty' }
  // 只接受纯非负整数：小数、负号、科学计数法、字母、超长数字都判为非法
  if (!ANSWER_PATTERN.test(text)) return { ok: false, reason: 'invalid' }
  return { ok: true, value: Number(text) }
}

function rejectAnswer(reason) {
  if (reason === 'empty') {
    showMessage('先写下答案再提交哦！', 'try')
  } else {
    showMessage('请输入 0～999999 的整数答案哦！', 'try')
  }
  answerEl.setAttribute('aria-invalid', 'true')
  answerEl.focus()
  answerEl.select()
}

/* --------------------------- 判题计分 ---------------------------- */

form.addEventListener('submit', (event) => {
  event.preventDefault()

  // 防重复提交 / 防重复计分：只有「正在作答」阶段才处理提交
  if (state.phase !== 'answering') return

  const parsed = parseAnswer(answerEl)
  if (!parsed.ok) {
    rejectAnswer(parsed.reason)
    return
  }

  // 记录本次作答对应的题号，供过期回调校验使用
  const answeredQuestionId = state.questionId

  if (parsed.value === state.first + state.second) {
    // 先锁定阶段再计分：同一题的后续提交会被入口守卫直接忽略
    state.phase = 'locked'
    state.score += 1
    state.streak += 1
    renderScore()
    showMessage(
      state.streak > 1 ? `太棒了！连续答对 ${state.streak} 题！🎉` : '答对啦！你真聪明！🎉',
      'good',
    )
    answerEl.setAttribute('aria-invalid', 'false')
    setAnsweringEnabled(false) // 禁用输入与提交按钮
    scheduleNextQuestion(answeredQuestionId)
  } else {
    state.streak = 0
    renderScore()
    showMessage('再想一想，你一定可以的！💪', 'try')
    answerEl.setAttribute('aria-invalid', 'false')
    answerEl.select()
  }
})

/* --------------------------- 换一道题 ---------------------------- */

newGameBtn.addEventListener('click', () => {
  // 先清掉可能在等待中的自动出题计时器，避免回调与新题目互相干扰
  clearNextQuestionTimer()
  showMessage('准备好了吗？')
  newQuestion()
})

// 初始渲染：分数、连续、第一道题统一由 state 输出，视图与状态始终一致
renderScore()
newQuestion()
