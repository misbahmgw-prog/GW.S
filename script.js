/* =====================================================
   GW Work — app logic
   Everything is stored in this browser (localStorage).
   ===================================================== */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- State ---------- */

const store = {
  users: load("gw_users", []),
  jobs: load("gw_jobs", []),
  messages: load("gw_messages", []),
  portfolios: load("gw_portfolios", []),
};

let currentUser = null;
let currentSkills = [];
let activeThreadId = null;
let currentPage = "dashboard";

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveData() {
  localStorage.setItem("gw_users", JSON.stringify(store.users));
  localStorage.setItem("gw_jobs", JSON.stringify(store.jobs));
  localStorage.setItem("gw_messages", JSON.stringify(store.messages));
  localStorage.setItem("gw_portfolios", JSON.stringify(store.portfolios));
}

/* Upgrade data written by the previous version of the app. */
function migrate() {
  store.jobs.forEach((job) => {
    if (!job.status) job.status = "open";
    if (!Array.isArray(job.applicants)) job.applicants = [];
    job.applicants = job.applicants.map((a) =>
      typeof a === "object"
        ? a
        : { userId: a, name: (store.users.find((u) => u.id === a) || {}).name || "Freelancer", note: "", at: null }
    );
    job.applicants.forEach((a) => { if (!a.status) a.status = "pending"; });
    if (job.createdAt && isNaN(Date.parse(job.createdAt))) job.createdAt = null;
  });
  store.messages.forEach((m) => {
    if (typeof m.read !== "boolean") m.read = true;
    if (m.time && isNaN(Date.parse(m.time))) m.time = null;
  });
  saveData();
}

/* ---------- Security helpers ---------- */

async function hashPassword(password) {
  if (!(crypto && crypto.subtle)) return "plain:" + password;
  const bytes = new TextEncoder().encode("gw-work|" + password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(user, password) {
  if (user.passwordHash) return user.passwordHash === (await hashPassword(password));
  return user.password === password; // legacy account
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email);
}

/* ---------- Formatting ---------- */

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

function hueFor(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function avatarHTML(name, cls = "") {
  return `<span class="avatar ${cls}" style="--h:${hueFor(name)}">${escapeHTML(initials(name))}</span>`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clockTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---------- Toasts & sheets ---------- */

function toast(text, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  const icon =
    type === "error"
      ? '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v7h-2zm0 9h2v2h-2z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.5-4-4L8 11l2.5 2.5L16 8l1.5 1.5z"/></svg>';
  el.innerHTML = icon + `<span>${escapeHTML(text)}</span>`;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function openSheet(title, bodyHTML) {
  $("sheetTitle").textContent = title;
  $("sheetBody").innerHTML = bodyHTML;
  $("sheet").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const first = $("sheetBody").querySelector("input, textarea, button");
  if (first) first.focus();
}

function closeSheet() {
  $("sheet").classList.add("hidden");
  $("sheetBody").innerHTML = "";
  document.body.style.overflow = "";
}

function confirmSheet(title, text, actionLabel, onConfirm, danger = true) {
  openSheet(
    title,
    `<p class="lead">${escapeHTML(text)}</p>
     <div class="form-actions">
       <button class="btn btn-secondary" data-close>Cancel</button>
       <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirmBtn">${escapeHTML(actionLabel)}</button>
     </div>`
  );
  $("confirmBtn").onclick = () => {
    closeSheet();
    onConfirm();
  };
}

/* ---------- Theme ---------- */

function applyTheme() {
  const saved = localStorage.getItem("gw_theme");
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const label = dark ? "Light mode" : "Dark mode";
  if ($("themeLabel")) $("themeLabel").textContent = label;
  if ($("themeToggleProfile")) $("themeToggleProfile").textContent = label;
  if ($("themeHint")) $("themeHint").textContent = saved ? (dark ? "Dark" : "Light") : "Follows your device setting";
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  localStorage.setItem("gw_theme", dark ? "light" : "dark");
  applyTheme();
}

/* ---------- Segmented controls ---------- */

function syncSegmented(group) {
  const inputs = $$('input[type="radio"]', group);
  const idx = Math.max(0, inputs.findIndex((i) => i.checked));
  group.style.setProperty("--count", inputs.length);
  group.style.setProperty("--idx", idx);
}

/* =====================================================
   AUTH
   ===================================================== */

let revealObserver = null;
function setupReveal() {
  if (!("IntersectionObserver" in window)) {
    $$(".reveal").forEach((el) => el.classList.add("in"));
    return;
  }
  revealObserver = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); } }),
    { threshold: 0.12 }
  );
  $$(".reveal").forEach((el) => revealObserver.observe(el));
}

function countUp(el, target) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || target === 0) { el.textContent = target; return; }
  const start = performance.now(), dur = 700;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showLanding() {
  $("landing").classList.remove("hidden");
  $$("#landing .reveal").forEach((el) => { el.classList.remove("in"); revealObserver && revealObserver.observe(el); });
  $("authPage").classList.add("hidden");
  $("app").classList.add("hidden");
  window.scrollTo({ top: 0 });
}

function showAuth(mode, role) {
  $("landing").classList.add("hidden");
  $("authPage").classList.remove("hidden");
  if (role) {
    $(role === "Client" ? "roleClient" : "roleFreelancer").checked = true;
    updateRoleCopy();
    $$(".segmented").forEach(syncSegmented);
  }
  mode === "register" ? showRegister() : showLogin();
}

function updateRoleCopy() {
  const client = $("roleClient").checked;
  $("registerTitle").textContent = client ? "Create a client account" : "Create a freelancer account";
  $("roleHint").textContent = client
    ? "Clients post jobs, review proposals and hire freelancers."
    : "Freelancers browse jobs, send proposals and build a portfolio.";
}

function showRegister() {
  $("loginBox").classList.add("hidden");
  $("registerBox").classList.remove("hidden");
  clearErrors();
  updateRoleCopy();
  $("registerName").focus();
}

function showLogin() {
  $("registerBox").classList.add("hidden");
  $("loginBox").classList.remove("hidden");
  clearErrors();
  $("loginEmail").focus();
}

function clearErrors() {
  $$(".form-error").forEach((e) => (e.textContent = ""));
}

async function createAccount(event) {
  event.preventDefault();
  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const password = $("registerPassword").value;
  const role = document.querySelector('input[name="registerRole"]:checked').value;
  const error = $("registerError");
  error.textContent = "";

  if (!name) return setError(error, "Enter your full name.", "registerName");
  if (!validEmail(email)) return setError(error, "Enter a valid email address, like name@example.com.", "registerEmail");
  if (password.length < 8) return setError(error, "Use at least 8 characters for your password.", "registerPassword");
  if (store.users.some((u) => u.email === email)) return setError(error, "An account with this email already exists. Sign in instead.", "registerEmail");

  const user = {
    id: Date.now(),
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
    title: "",
    bio: "",
    company: "",
    skills: [],
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  saveData();
  $("registerBox").reset();
  signIn(user);
  toast(`Welcome to GW Work, ${user.name.split(" ")[0]}`);
}

async function login(event) {
  event.preventDefault();
  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;
  const error = $("loginError");
  error.textContent = "";

  if (!validEmail(email)) return setError(error, "Enter a valid email address.", "loginEmail");
  if (!password) return setError(error, "Enter your password.", "loginPassword");

  const user = store.users.find((u) => u.email === email);
  if (!user || !(await verifyPassword(user, password))) {
    return setError(error, "That email and password don't match an account.", "loginPassword");
  }

  if (!user.passwordHash) {
    // upgrade legacy plain-text password
    user.passwordHash = await hashPassword(password);
    delete user.password;
    saveData();
  }

  $("loginBox").reset();
  signIn(user);
}

function setError(el, text, focusId) {
  el.textContent = text;
  if (focusId) $(focusId).focus();
}

function signIn(user) {
  currentUser = user;
  localStorage.setItem("gw_session", String(user.id));
  $("landing").classList.add("hidden");
  $("authPage").classList.add("hidden");
  $("app").classList.remove("hidden");
  setupUserInterface();
  showPage("dashboard");
}

function logout() {
  currentUser = null;
  activeThreadId = null;
  localStorage.removeItem("gw_session");
  showLanding();
  toast("Signed out");
}

function restoreSession() {
  const id = Number(localStorage.getItem("gw_session"));
  const user = store.users.find((u) => u.id === id);
  if (user) signIn(user);
  else showLanding();
}

function deleteAccount() {
  openSheet(
    "Delete your account?",
    `<p class="lead">This permanently removes your profile, jobs, portfolio and messages from this browser. It can't be undone.</p>
     <div class="field">
       <input id="deleteConfirm" placeholder=" " autocomplete="off">
       <label for="deleteConfirm">Type DELETE to confirm</label>
     </div>
     <div class="form-actions">
       <button class="btn btn-secondary" data-close>Cancel</button>
       <button class="btn btn-danger" id="confirmBtn" disabled>Delete account</button>
     </div>`
  );
  $("deleteConfirm").addEventListener("input", (e) => ($("confirmBtn").disabled = e.target.value.trim() !== "DELETE"));
  $("confirmBtn").onclick = () => {
    closeSheet();
    (() => {
      const id = currentUser.id;
      store.users = store.users.filter((u) => u.id !== id);
      store.jobs = store.jobs.filter((j) => j.clientId !== id);
      store.jobs.forEach((j) => (j.applicants = j.applicants.filter((a) => a.userId !== id)));
      store.messages = store.messages.filter((m) => m.fromId !== id && m.toId !== id);
      store.portfolios = store.portfolios.filter((p) => p.userId !== id);
      saveData();
      logout();
      toast("Account deleted");
    })();
  };
}

/* =====================================================
   UI SETUP & NAVIGATION
   ===================================================== */

const isClient = () => currentUser?.role === "Client";
const isFreelancer = () => currentUser?.role === "Freelancer";
const firstName = () => (currentUser?.name || "").split(" ")[0];

function setupUserInterface() {
  const hue = hueFor(currentUser.name);
  ["sideAvatar", "profileAvatar"].forEach((id) => {
    $(id).textContent = initials(currentUser.name);
    $(id).style.setProperty("--h", hue);
  });
  $("sideName").textContent = currentUser.name;
  $("sideRole").textContent = currentUser.role;
  $("profileName").textContent = currentUser.name;
  $("profileRole").textContent = currentUser.role;
  $("profileEmail").textContent = currentUser.email;
  $("accountEmail").textContent = currentUser.email;

  $$(".freelancer-only").forEach((el) => el.classList.toggle("hidden", !isFreelancer()));
  $$(".client-only").forEach((el) => el.classList.toggle("hidden", !isClient()));

  if (isClient()) {
    $("heroTitle").textContent = "Find the right freelancer.";
    $("heroText").textContent = "Post a project, review proposals and message the people you want to work with.";
    $("heroAction").textContent = "Post a job";
    $("heroAction").dataset.page = "postjob";
    $("jobsHeading").textContent = "My jobs";
    $("jobsSub").textContent = "Jobs you've posted and the proposals they've received.";
    $("jobsNavText").textContent = "My jobs";
    $("statOneLabel").textContent = "Open jobs";
    $("statTwoLabel").textContent = "Proposals received";
    $("statThreeLabel").textContent = "In progress";
    $("recentTitle").textContent = "Your jobs";
    $("profileSub").textContent = "Freelancers see this when they apply to your jobs.";
  } else {
    $("heroTitle").textContent = "Build your freelance career.";
    $("heroText").textContent = "Find projects, send proposals and show clients what you can do.";
    $("heroAction").textContent = "Browse jobs";
    $("heroAction").dataset.page = "jobs";
    $("jobsHeading").textContent = "Find jobs";
    $("jobsSub").textContent = "Open projects from clients on GW Work.";
    $("jobsNavText").textContent = "Find jobs";
    $("statOneLabel").textContent = "Open jobs";
    $("statTwoLabel").textContent = "Proposals sent";
    $("statThreeLabel").textContent = "Hired";
    $("recentTitle").textContent = "New jobs";
    $("profileSub").textContent = "Clients see this when you apply to a job.";
  }

  loadProfile();
  updateBadge();
}

function showPage(pageName) {
  if (!$(pageName)) pageName = "dashboard";
  currentPage = pageName;
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === pageName));
  $$(".nav-btn[data-page], .tab[data-page]").forEach((b) => b.classList.toggle("active", b.dataset.page === pageName));
  window.scrollTo({ top: 0 });

  if (pageName === "dashboard") renderDashboard();
  if (pageName === "jobs") renderJobs();
  if (pageName === "messages") renderMessages();
  if (pageName === "portfolio") renderPortfolio();
}

/* =====================================================
   DASHBOARD
   ===================================================== */

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function myJobs() {
  return isClient() ? store.jobs.filter((j) => j.clientId === currentUser.id) : store.jobs.filter((j) => j.status === "open");
}

function myMessages() {
  return store.messages.filter((m) => m.fromId === currentUser.id || m.toId === currentUser.id);
}

function unreadCount() {
  return store.messages.filter((m) => m.toId === currentUser.id && !m.read).length;
}

function renderDashboard() {
  $("welcomeText").innerHTML = `${greeting()}, <span class="welcome-name">${escapeHTML(firstName())}</span>`;
  const jobs = myJobs();
  const unread = unreadCount();

  let proposals;
  if (isClient()) {
    proposals = jobs.reduce((n, j) => n + j.applicants.length, 0);
  } else {
    proposals = store.jobs.filter((j) => j.applicants.some((a) => a.userId === currentUser.id)).length;
  }

  countUp($("statOne"), isClient() ? jobs.filter((j) => j.status === "open").length : jobs.length);
  countUp($("statTwo"), proposals);
  countUp($("statThree"), isClient()
    ? jobs.filter((j) => j.status === "in progress").length
    : store.jobs.filter((j) => j.hiredId === currentUser.id).length);
  $("welcomeSub").textContent =
    unread > 0
      ? `You have ${unread} unread message${unread === 1 ? "" : "s"}.`
      : jobs.length
      ? isClient()
        ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} posted.`
        : `${jobs.length} open job${jobs.length === 1 ? "" : "s"} to look at.`
      : "Here's what's happening today.";

  // recent jobs
  const recent = jobs.slice(0, 4);
  $("recentJobs").innerHTML = recent.length
    ? recent
        .map(
          (j) => `
      <button class="list-item" data-open-job="${j.id}">
        <div class="list-text">
          <strong>${escapeHTML(j.title)}</strong>
          <span>${escapeHTML(j.budget)} · ${isClient() ? `${j.applicants.length} proposal${j.applicants.length === 1 ? "" : "s"}` : escapeHTML(j.clientName)}</span>
        </div>
        <span class="list-meta">${timeAgo(j.createdAt)}</span>
      </button>`
        )
        .join("")
    : `<div class="empty"><strong>${isClient() ? "No jobs yet" : "No open jobs"}</strong><span>${
        isClient() ? "Post your first job to start receiving proposals." : "New jobs from clients will show up here."
      }</span></div>`;

  // recent messages
  const threads = buildThreads().slice(0, 4);
  $("recentMessages").innerHTML = threads.length
    ? threads
        .map(
          (t) => `
      <button class="list-item" data-open-thread="${t.otherId}">
        ${avatarHTML(t.otherName, "avatar-sm")}
        <div class="list-text">
          <strong>${escapeHTML(t.otherName)}</strong>
          <span>${escapeHTML(t.last.text)}</span>
        </div>
        ${t.unread ? '<span class="unread" style="width:8px;height:8px;border-radius:50%;background:var(--accent)"></span>' : `<span class="list-meta">${timeAgo(t.last.time)}</span>`}
      </button>`
        )
        .join("")
    : `<div class="empty"><strong>No messages yet</strong><span>${
        isClient() ? "You'll hear from freelancers when they apply." : "Apply to a job to start a conversation."
      }</span></div>`;
}

/* =====================================================
   JOBS
   ===================================================== */

function postJob(event) {
  event.preventDefault();
  if (!isClient()) return;

  const title = $("jobTitle").value.trim();
  const description = $("jobDescription").value.trim();
  const budget = $("jobBudget").value.trim();
  const skillsText = $("jobSkills").value.trim();
  const error = $("jobError");
  error.textContent = "";

  if (!title) return setError(error, "Give the job a title.", "jobTitle");
  if (description.length < 20) return setError(error, "Describe the project in at least a sentence or two.", "jobDescription");
  if (!budget) return setError(error, "Add a budget so freelancers know what to expect.", "jobBudget");
  const skills = skillsText.split(",").map((s) => s.trim()).filter(Boolean);
  if (!skills.length) return setError(error, "List at least one required skill.", "jobSkills");

  store.jobs.unshift({
    id: Date.now(),
    clientId: currentUser.id,
    clientName: currentUser.name,
    title,
    description,
    budget,
    skills,
    status: "open",
    createdAt: new Date().toISOString(),
    applicants: [],
  });
  saveData();
  $("postJobForm").reset();
  toast("Job published");
  showPage("jobs");
}

function visibleJobs() {
  const q = ($("jobSearch").value || "").trim().toLowerCase();
  let list;
  if (isClient()) {
    list = store.jobs.filter((j) => j.clientId === currentUser.id);
    const status = document.querySelector('input[name="jobStatus"]:checked')?.value || "open";
    if (status === "done") list = list.filter((j) => j.status === "done" || j.status === "closed");
    else if (status !== "all") list = list.filter((j) => j.status === status);
  } else {
    const view = document.querySelector('input[name="jobView"]:checked')?.value || "browse";
    list = view === "mine"
      ? store.jobs.filter((j) => j.applicants.some((a) => a.userId === currentUser.id))
      : store.jobs.filter((j) => j.status === "open");
  }
  if (q) {
    list = list.filter((j) =>
      [j.title, j.description, j.clientName, j.budget, ...(j.skills || [])].join(" ").toLowerCase().includes(q)
    );
  }
  return list;
}

function renderJobs() {
  const container = $("jobsList");
  const list = visibleJobs();
  const q = $("jobSearch").value.trim();

  if (!list.length) {
    container.innerHTML = q
      ? `<div class="empty"><strong>No jobs match "${escapeHTML(q)}"</strong><span>Try a different title, skill or client name.</span></div>`
      : isClient()
      ? `<div class="empty"><strong>No jobs here</strong><span>Post a job and freelancers will send you proposals.</span><button class="btn btn-primary" data-page="postjob">Post a job</button></div>`
      : document.querySelector('input[name="jobView"]:checked')?.value === "mine"
      ? `<div class="empty"><strong>No proposals yet</strong><span>Jobs you apply to will be tracked here, with their status.</span></div>`
      : `<div class="empty"><strong>No open jobs right now</strong><span>Check back soon — new projects show up here as clients post them.</span></div>`;
    return;
  }

  container.innerHTML = list.map(jobCardHTML).join("");
}

const STATUS_LABEL = { open: "Open", "in progress": "In progress", done: "Completed", closed: "Closed" };
const STATUS_CLASS = { open: "ok", "in progress": "progress", done: "", closed: "" };

function statusTag(job) {
  return `<span class="tag ${STATUS_CLASS[job.status] || ""}">${STATUS_LABEL[job.status] || job.status}</span>`;
}

function myProposal(job) {
  return job.applicants.find((a) => a.userId === currentUser.id);
}

function proposalTag(p, job) {
  if (!p) return "";
  if (p.status === "accepted") return `<span class="tag hired">${job.status === "done" ? "Completed" : "Hired"}</span>`;
  if (p.status === "declined") return '<span class="tag declined">Not selected</span>';
  if (job.status !== "open") return '<span class="tag">Position filled</span>';
  return '<span class="tag">Proposal sent</span>';
}

function jobCardHTML(job) {
  const skills = job.skills.map((s) => `<span class="chip soft">${escapeHTML(s)}</span>`).join("");
  const n = job.applicants.length;
  const pending = job.applicants.filter((a) => a.status === "pending").length;

  let foot;
  if (isFreelancer()) {
    const p = myProposal(job);
    foot = `
      <span class="meta">${escapeHTML(job.clientName)} · ${timeAgo(job.createdAt)}</span>
      <div class="card-actions">
        ${p
          ? proposalTag(p, job) + (p.status === "accepted" ? `<button class="btn btn-secondary btn-sm" data-message-user="${job.clientId}">Message</button>` : "")
          : `<button class="btn btn-primary btn-sm" data-apply="${job.id}">Apply</button>`}
      </div>`;
  } else {
    let actions = "";
    if (job.status === "open") {
      actions = `
        ${n ? `<button class="btn ${pending ? "btn-primary" : "btn-secondary"} btn-sm" data-applicants="${job.id}">${pending ? `Review ${pending}` : "Proposals"}</button>` : ""}
        <button class="btn btn-secondary btn-sm" data-close-job="${job.id}">Close</button>`;
    } else if (job.status === "in progress") {
      actions = `
        <button class="btn btn-secondary btn-sm" data-message-user="${job.hiredId}">Message</button>
        <button class="btn btn-primary btn-sm" data-complete-job="${job.id}">Mark complete</button>`;
    } else if (job.status === "closed") {
      actions = `<button class="btn btn-secondary btn-sm" data-reopen-job="${job.id}">Reopen</button>`;
    } else {
      actions = n ? `<button class="btn btn-secondary btn-sm" data-applicants="${job.id}">Proposals</button>` : "";
    }
    foot = `
      <span class="meta">${timeAgo(job.createdAt)} · ${job.hiredName ? `Hired ${escapeHTML(job.hiredName)}` : `${n} proposal${n === 1 ? "" : "s"}`}</span>
      <div class="card-actions">
        ${actions}
        <button class="icon-btn" data-delete-job="${job.id}" aria-label="Delete job">
          <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 5h12l-1 13H7z"/></svg>
        </button>
      </div>`;
  }

  return `
    <article class="card ${job.status === "closed" || job.status === "done" ? "closed" : ""}">
      <div class="card-head">
        <h3>${escapeHTML(job.title)}</h3>
        <span class="budget">${escapeHTML(job.budget)}</span>
      </div>
      <div class="chips" style="margin-bottom:10px">${isClient() || job.status !== "open" ? statusTag(job) : ""}</div>
      <p class="desc">${escapeHTML(job.description)}</p>
      <div class="chips">${skills}</div>
      <div class="card-foot">${foot}</div>
    </article>`;
}

function openJobDetail(jobId) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) return;
  const applied = job.applicants.some((a) => a.userId === currentUser.id);
  openSheet(
    job.title,
    `<p class="muted small" style="margin-bottom:12px">${escapeHTML(job.clientName)} · ${escapeHTML(job.budget)} · ${timeAgo(job.createdAt)}</p>
     <p style="white-space:pre-wrap;line-height:1.55">${escapeHTML(job.description)}</p>
     <div class="chips" style="margin-top:16px">${job.skills.map((s) => `<span class="chip soft">${escapeHTML(s)}</span>`).join("")}</div>
     <div class="form-actions">
       ${isFreelancer() && job.status === "open"
         ? applied
           ? '<span class="tag ok">Applied</span>'
           : `<button class="btn btn-primary" data-apply="${job.id}">Apply</button>`
         : isClient() && job.applicants.length
         ? `<button class="btn btn-primary" data-applicants="${job.id}">View ${job.applicants.length} proposal${job.applicants.length === 1 ? "" : "s"}</button>`
         : '<button class="btn btn-secondary" data-close>Done</button>'}
     </div>`
  );
}

function openApply(jobId) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job || !isFreelancer()) return;
  if (job.applicants.some((a) => a.userId === currentUser.id)) return;

  const hasProfile = currentUser.title || currentUser.skills?.length;
  openSheet(
    `Apply to ${job.title}`,
    `<p class="lead">${escapeHTML(job.clientName)} will see your profile${hasProfile ? "" : " — it's empty right now, so consider filling it in first"} and the note below.</p>
     <div class="field">
       <textarea id="applyNote" placeholder=" " rows="4" maxlength="600"></textarea>
       <label for="applyNote">Short note to the client (optional)</label>
     </div>
     <div class="form-actions">
       <button class="btn btn-secondary" data-close>Cancel</button>
       <button class="btn btn-primary" id="applySubmit">Send proposal</button>
     </div>`
  );
  $("applySubmit").onclick = () => {
    const note = $("applyNote").value.trim();
    applyJob(job.id, note);
    closeSheet();
  };
}

function applyJob(jobId, note) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job || job.applicants.some((a) => a.userId === currentUser.id)) return;

  job.applicants.push({ userId: currentUser.id, name: currentUser.name, note, at: new Date().toISOString(), status: "pending" });
  store.messages.push({
    id: Date.now(),
    fromId: currentUser.id,
    toId: job.clientId,
    fromName: currentUser.name,
    toName: job.clientName,
    text: note ? `I'd like to work on "${job.title}".\n\n${note}` : `I'd like to work on "${job.title}".`,
    time: new Date().toISOString(),
    read: false,
  });
  saveData();
  toast("Proposal sent");
  if (currentPage === "jobs") renderJobs();
  if (currentPage === "dashboard") renderDashboard();
}

function openApplicants(jobId) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job || !isClient()) return;
  const rows = job.applicants
    .slice()
    .reverse()
    .map((a) => {
      const u = store.users.find((x) => x.id === a.userId);
      const name = u?.name || a.name;
      const skills = (u?.skills || []).slice(0, 4).map((sk) => `<span class="chip soft">${escapeHTML(sk)}</span>`).join("");
      const decided = a.status !== "pending";
      return `
      <div class="applicant" style="flex-wrap:wrap">
        ${avatarHTML(name)}
        <div class="list-text">
          <strong>${escapeHTML(name)} ${a.status === "accepted" ? '<span class="tag hired">Hired</span>' : a.status === "declined" ? '<span class="tag declined">Declined</span>' : ""}</strong>
          <span>${escapeHTML(u?.title || "Freelancer")}${a.at ? " · " + timeAgo(a.at) : ""}</span>
          ${a.note ? `<div class="note">${escapeHTML(a.note)}</div>` : ""}
          ${skills ? `<div class="chips" style="margin:8px 0 0">${skills}</div>` : ""}
        </div>
        <div class="card-actions" style="width:100%;justify-content:flex-end;margin-top:4px">
          ${u ? `<button class="btn btn-secondary btn-sm" data-view-user="${u.id}">Profile</button>` : ""}
          ${u ? `<button class="btn btn-secondary btn-sm" data-message-user="${u.id}">Message</button>` : ""}
          ${!decided && job.status === "open" && u
            ? `<button class="btn btn-secondary btn-sm" data-decline="${job.id}:${u.id}">Decline</button>
               <button class="btn btn-primary btn-sm" data-accept="${job.id}:${u.id}">Hire</button>`
            : ""}
        </div>
      </div>`;
    })
    .join("");
  openSheet(`Proposals · ${job.title}`, (job.status === "open" ? '<p class="lead">Hiring someone moves the job to In progress and notifies everyone who applied.</p>' : "") + (rows || '<p class="lead">No proposals yet.</p>'));
}

function systemMessage(toId, toName, text) {
  store.messages.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    fromId: currentUser.id,
    toId,
    fromName: currentUser.name,
    toName,
    text,
    time: new Date().toISOString(),
    read: false,
    system: true,
  });
}

function acceptProposal(jobId, userId) {
  const job = store.jobs.find((j) => j.id === jobId);
  const u = store.users.find((x) => x.id === userId);
  if (!job || !u || job.status !== "open") return;
  confirmSheet(`Hire ${u.name}?`, `"${job.title}" will move to In progress. Other applicants will be told the position is filled.`, `Hire ${u.name.split(" ")[0]}`, () => {
    job.applicants.forEach((a) => {
      if (a.userId === userId) a.status = "accepted";
      else if (a.status === "pending") {
        a.status = "declined";
        const other = store.users.find((x) => x.id === a.userId);
        if (other) systemMessage(other.id, other.name, `The position for "${job.title}" has been filled. Thanks for applying.`);
      }
    });
    job.status = "in progress";
    job.hiredId = u.id;
    job.hiredName = u.name;
    job.hiredAt = new Date().toISOString();
    systemMessage(u.id, u.name, `You've been hired for "${job.title}". Let's get started.`);
    saveData();
    renderJobs();
    toast(`${u.name.split(" ")[0]} hired`);
  }, false);
}

function declineProposal(jobId, userId) {
  const job = store.jobs.find((j) => j.id === jobId);
  const a = job?.applicants.find((x) => x.userId === userId);
  if (!a || a.status !== "pending") return;
  a.status = "declined";
  const u = store.users.find((x) => x.id === userId);
  if (u) systemMessage(u.id, u.name, `Your proposal for "${job.title}" wasn't selected this time.`);
  saveData();
  openApplicants(jobId);
  renderJobs();
  toast("Proposal declined");
}

function completeJob(jobId) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== "in progress") return;
  confirmSheet("Mark this job complete?", `"${job.title}" will be marked as completed for you and ${job.hiredName}.`, "Mark complete", () => {
    job.status = "done";
    job.completedAt = new Date().toISOString();
    if (job.hiredId) systemMessage(job.hiredId, job.hiredName, `"${job.title}" has been marked complete. Great work.`);
    saveData();
    renderJobs();
    toast("Job completed");
  }, false);
}

function closeJob(jobId, reopen = false) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.status = reopen ? "open" : "closed";
  saveData();
  renderJobs();
  toast(reopen ? "Job reopened" : "Job closed");
}

function deleteJob(jobId) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) return;
  confirmSheet("Delete this job?", `"${job.title}" and its proposals will be removed. Messages stay.`, "Delete", () => {
    store.jobs = store.jobs.filter((j) => j.id !== jobId);
    saveData();
    renderJobs();
    toast("Job deleted");
  });
}

/* =====================================================
   MESSAGES
   ===================================================== */

function otherPartyOf(m) {
  return m.fromId === currentUser.id ? { id: m.toId, name: m.toName } : { id: m.fromId, name: m.fromName };
}

function buildThreads() {
  const map = new Map();
  myMessages().forEach((m) => {
    const other = otherPartyOf(m);
    const live = store.users.find((u) => u.id === other.id);
    const t = map.get(other.id) || { otherId: other.id, otherName: live?.name || other.name, messages: [], unread: 0 };
    t.messages.push(m);
    if (m.toId === currentUser.id && !m.read) t.unread++;
    map.set(other.id, t);
  });
  return Array.from(map.values())
    .map((t) => {
      t.messages.sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
      t.last = t.messages[t.messages.length - 1];
      return t;
    })
    .sort((a, b) => new Date(b.last.time || 0) - new Date(a.last.time || 0));
}

function updateBadge() {
  const n = unreadCount();
  $("messageBadge").textContent = n;
  $("messageBadge").classList.toggle("hidden", n === 0);
  $("tabBadge").classList.toggle("hidden", n === 0);
}

function renderMessages() {
  const threads = buildThreads();
  const list = $("threadList");
  const chat = $("chat");

  if (!threads.length) {
    list.innerHTML = `<div class="empty"><strong>No conversations</strong><span>${
      isClient() ? "Freelancers who apply to your jobs will appear here." : "Apply to a job to start a conversation."
    }</span></div>`;
    $("conversation").innerHTML = `<div class="empty"><strong>Nothing here yet</strong><span>Your messages will show up on this side.</span></div>`;
    chat.classList.remove("show-conv");
    return;
  }

  if (activeThreadId && !threads.some((t) => t.otherId === activeThreadId)) activeThreadId = null;

  list.innerHTML = threads
    .map(
      (t) => `
    <button class="thread ${t.otherId === activeThreadId ? "active" : ""}" data-thread="${t.otherId}">
      ${avatarHTML(t.otherName)}
      <div class="list-text">
        <strong>${escapeHTML(t.otherName)}</strong>
        <span>${escapeHTML(t.last.text)}</span>
      </div>
      ${t.unread ? '<span class="unread"></span>' : `<span class="list-meta">${timeAgo(t.last.time)}</span>`}
    </button>`
    )
    .join("");

  if (activeThreadId) renderConversation(activeThreadId);
  else {
    $("conversation").innerHTML = `<div class="empty"><strong>Select a conversation</strong><span>Pick someone on the left to read and reply.</span></div>`;
    chat.classList.remove("show-conv");
  }
}

function openThread(otherId) {
  activeThreadId = otherId;
  if (currentPage !== "messages") showPage("messages");
  else renderMessages();
}

function renderConversation(otherId) {
  const t = buildThreads().find((x) => x.otherId === otherId);
  if (!t) return;

  let changed = false;
  t.messages.forEach((m) => {
    if (m.toId === currentUser.id && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) {
    saveData();
    updateBadge();
    $$(`.thread[data-thread="${otherId}"] .unread`).forEach((el) => el.remove());
  }

  const other = store.users.find((u) => u.id === otherId);
  $("chat").classList.add("show-conv");
  $("conversation").innerHTML = `
    <div class="conv-head">
      <button class="icon-btn back" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 4.5 8.5 11l6.5 6.5-1.4 1.4L5.7 11l7.9-7.9z"/></svg></button>
      ${avatarHTML(t.otherName)}
      <div><strong>${escapeHTML(t.otherName)}</strong><span>${escapeHTML(other?.role || "")}${other?.title ? " · " + escapeHTML(other.title) : ""}</span></div>
      ${other ? `<button class="link" data-view-user="${other.id}">View profile</button>` : ""}
    </div>
    <div class="bubbles" id="bubbles">
      ${t.messages
        .map((m) => {
          const me = m.fromId === currentUser.id;
          if (m.system) return `<div class="bubble system">${escapeHTML(m.text)} · ${clockTime(m.time)}</div>`;
          return `<div class="bubble ${me ? "me" : "them"}">${escapeHTML(m.text)}</div><div class="bubble-time ${me ? "me" : ""}">${clockTime(m.time)}</div>`;
        })
        .join("")}
    </div>
    <form class="composer" id="composer">
      <textarea id="composerInput" rows="1" placeholder="Message ${escapeHTML(t.otherName.split(" ")[0])}"></textarea>
      <button type="submit" class="send" aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M3 11.5 21 3l-4 18-5.5-6.5zM11 13l3.5 4.5L18 6.5 6 11z"/></svg></button>
    </form>`;

  const bubbles = $("bubbles");
  bubbles.scrollTop = bubbles.scrollHeight;

  const input = $("composerInput");
  const send = $("composer").querySelector(".send");
  input.addEventListener("input", () => {
    send.disabled = !input.value.trim();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(otherId, t.otherName, input.value);
  });
  if (matchMedia("(min-width: 821px)").matches) input.focus();
}

function sendMessage(toId, toName, text) {
  text = text.trim();
  if (!text) return;
  store.messages.push({
    id: Date.now(),
    fromId: currentUser.id,
    toId,
    fromName: currentUser.name,
    toName,
    text,
    time: new Date().toISOString(),
    read: false,
  });
  saveData();
  renderMessages();
}

/* =====================================================
   PROFILE
   ===================================================== */

function loadProfile() {
  if (isFreelancer()) {
    $("freelancerProfile").classList.remove("hidden");
    $("clientProfile").classList.add("hidden");
    $("profileTitle").value = currentUser.title || "";
    $("profileBio").value = currentUser.bio || "";
    currentSkills = [...(currentUser.skills || [])];
    renderSkills();
  } else {
    $("freelancerProfile").classList.add("hidden");
    $("clientProfile").classList.remove("hidden");
    $("clientCompany").value = currentUser.company || "";
    $("clientBio").value = currentUser.bio || "";
  }
}

function addSkill() {
  const input = $("skillInput");
  const skill = input.value.trim().replace(/,+$/, "");
  if (!skill) return;
  if (currentSkills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
    toast("You already have that skill", "error");
  } else if (currentSkills.length >= 15) {
    toast("You can add up to 15 skills", "error");
  } else {
    currentSkills.push(skill);
  }
  input.value = "";
  renderSkills();
  input.focus();
}

function renderSkills() {
  $("skillsList").innerHTML = currentSkills.length
    ? currentSkills
        .map((s, i) => `<span class="chip">${escapeHTML(s)}<button type="button" data-remove-skill="${i}" aria-label="Remove ${escapeHTML(s)}">×</button></span>`)
        .join("")
    : '<span class="muted small">No skills yet. Add the things you\'re good at.</span>';
}

function saveProfile(event) {
  event.preventDefault();
  if (isFreelancer()) {
    currentUser.title = $("profileTitle").value.trim();
    currentUser.bio = $("profileBio").value.trim();
    currentUser.skills = [...currentSkills];
  } else {
    currentUser.company = $("clientCompany").value.trim();
    currentUser.bio = $("clientBio").value.trim();
  }
  const i = store.users.findIndex((u) => u.id === currentUser.id);
  if (i !== -1) store.users[i] = currentUser;
  saveData();
  toast("Changes saved");
}

function openPublicProfile(userId) {
  const u = store.users.find((x) => x.id === userId);
  if (!u) return;
  const projects = store.portfolios.filter((p) => p.userId === u.id);
  openSheet(
    u.name,
    `<div class="pp-head">
       ${avatarHTML(u.name, "avatar-lg")}
       <div>
         <h3>${escapeHTML(u.name)}</h3>
         <p class="muted">${escapeHTML(u.role === "Client" ? u.company || "Client" : u.title || "Freelancer")}</p>
       </div>
     </div>
     ${u.bio ? `<p style="line-height:1.55;white-space:pre-wrap">${escapeHTML(u.bio)}</p>` : '<p class="muted">No bio yet.</p>'}
     ${u.role === "Freelancer"
       ? `<div class="pp-section"><h4>Skills</h4><div class="chips" style="margin:0">${
           u.skills?.length ? u.skills.map((s) => `<span class="chip soft">${escapeHTML(s)}</span>`).join("") : '<span class="muted small">None listed</span>'
         }</div></div>
          <div class="pp-section"><h4>Portfolio</h4>${
            projects.length
              ? projects
                  .map(
                    (p) => `<div class="pp-project"><strong>${escapeHTML(p.title)}</strong><p>${escapeHTML(p.description)}</p>${
                      safeUrl(p.link) ? `<a class="link-out" href="${escapeHTML(safeUrl(p.link))}" target="_blank" rel="noopener noreferrer">Open project</a>` : ""
                    }</div>`
                  )
                  .join("")
              : '<p class="muted small">No projects yet</p>'
          }</div>`
       : ""}
     ${u.id !== currentUser.id ? `<div class="form-actions"><button class="btn btn-primary" data-message-user="${u.id}">Message</button></div>` : ""}`
  );
}

/* =====================================================
   PORTFOLIO
   ===================================================== */

function addPortfolio(event) {
  event.preventDefault();
  if (!isFreelancer()) return;
  const title = $("portfolioTitle").value.trim();
  const description = $("portfolioDescription").value.trim();
  const link = $("portfolioLink").value.trim();
  const error = $("portfolioError");
  error.textContent = "";

  if (!title) return setError(error, "Give the project a title.", "portfolioTitle");
  if (!description) return setError(error, "Describe what you did on this project.", "portfolioDescription");
  if (link && !safeUrl(link)) return setError(error, "Links need to start with https:// or http://.", "portfolioLink");

  store.portfolios.unshift({ id: Date.now(), userId: currentUser.id, title, description, link: link ? safeUrl(link) : "", createdAt: new Date().toISOString() });
  saveData();
  $("portfolioForm").reset();
  toast("Project added");
  renderPortfolio();
}

function renderPortfolio() {
  const mine = store.portfolios.filter((p) => p.userId === currentUser.id);
  $("portfolioList").innerHTML = mine.length
    ? mine
        .map(
          (p) => `
      <article class="card">
        <div class="card-head">
          <h3>${escapeHTML(p.title)}</h3>
          <button class="icon-btn" data-delete-portfolio="${p.id}" aria-label="Delete project">
            <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 5h12l-1 13H7z"/></svg>
          </button>
        </div>
        <p class="desc">${escapeHTML(p.description)}</p>
        <div class="card-foot">
          <span class="meta">${timeAgo(p.createdAt)}</span>
          ${safeUrl(p.link) ? `<a class="link-out" href="${escapeHTML(safeUrl(p.link))}" target="_blank" rel="noopener noreferrer">Open project</a>` : ""}
        </div>
      </article>`
        )
        .join("")
    : `<div class="empty"><strong>Your portfolio is empty</strong><span>Add a project below. Clients see these when you apply.</span></div>`;
}

function deletePortfolio(id) {
  const item = store.portfolios.find((p) => p.id === id);
  if (!item) return;
  confirmSheet("Remove this project?", `"${item.title}" will be removed from your portfolio.`, "Remove", () => {
    store.portfolios = store.portfolios.filter((p) => p.id !== id);
    saveData();
    renderPortfolio();
    toast("Project removed");
  });
}

/* =====================================================
   EVENTS
   ===================================================== */

document.addEventListener("DOMContentLoaded", () => {
  migrate();
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!localStorage.getItem("gw_theme")) applyTheme();
  });

  // forms
  $("loginBox").addEventListener("submit", login);
  $("registerBox").addEventListener("submit", createAccount);
  $("goRegister").addEventListener("click", showRegister);
  $("goLogin").addEventListener("click", showLogin);
  $("postJobForm").addEventListener("submit", postJob);
  $("freelancerProfile").addEventListener("submit", saveProfile);
  $("clientProfile").addEventListener("submit", saveProfile);
  $("portfolioForm").addEventListener("submit", addPortfolio);
  $("addSkillBtn").addEventListener("click", addSkill);
  $("skillInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill();
    }
  });
  $("logoutBtn").addEventListener("click", logout);
  $("logoutBtnProfile").addEventListener("click", logout);
  $("themeToggle").addEventListener("click", toggleTheme);
  $("themeToggleProfile").addEventListener("click", toggleTheme);
  $("landingSignIn").addEventListener("click", () => showAuth("login"));
  $("pathFreelancer").addEventListener("click", () => showAuth("register", "Freelancer"));
  $("pathClient").addEventListener("click", () => showAuth("register", "Client"));
  $$("#landing [data-role]").forEach((b) => b.addEventListener("click", () => showAuth("register", b.dataset.role)));
  setupReveal();
  $("backToLanding").addEventListener("click", showLanding);
  $$('input[name="registerRole"]').forEach((r) => r.addEventListener("change", updateRoleCopy));
  $$('input[name="jobView"]').forEach((r) => r.addEventListener("change", renderJobs));
  $("deleteAccountBtn").addEventListener("click", deleteAccount);
  $("jobSearch").addEventListener("input", renderJobs);
  $$('input[name="jobStatus"]').forEach((r) => r.addEventListener("change", renderJobs));

  // segmented controls
  $$(".segmented").forEach((g) => {
    syncSegmented(g);
    g.addEventListener("change", () => syncSegmented(g));
  });

  // password reveal
  $$(".reveal-pw").forEach((b) =>
    b.addEventListener("click", () => {
      const input = $(b.dataset.reveal);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    })
  );

  // sheet
  $("sheet").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("sheet").classList.contains("hidden")) closeSheet();
  });

  // delegated actions
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-page],[data-apply],[data-applicants],[data-close-job],[data-reopen-job],[data-delete-job],[data-open-job],[data-open-thread],[data-thread],[data-view-user],[data-message-user],[data-remove-skill],[data-delete-portfolio],[data-back],[data-accept],[data-decline],[data-complete-job]");
    if (!el || !currentUser) return;
    const d = el.dataset;
    if (d.page) return showPage(d.page);
    if (d.apply) return openApply(Number(d.apply));
    if (d.applicants) return openApplicants(Number(d.applicants));
    if (d.closeJob) return closeJob(Number(d.closeJob));
    if (d.reopenJob) return closeJob(Number(d.reopenJob), true);
    if (d.deleteJob) return deleteJob(Number(d.deleteJob));
    if (d.completeJob) return completeJob(Number(d.completeJob));
    if (d.accept) { const [j, u] = d.accept.split(":").map(Number); return acceptProposal(j, u); }
    if (d.decline) { const [j, u] = d.decline.split(":").map(Number); return declineProposal(j, u); }
    if (d.openJob) return openJobDetail(Number(d.openJob));
    if (d.openThread) return openThread(Number(d.openThread));
    if (d.thread) return openThread(Number(d.thread));
    if (d.viewUser) return openPublicProfile(Number(d.viewUser));
    if (d.messageUser) {
      closeSheet();
      return openThreadWith(Number(d.messageUser));
    }
    if (d.removeSkill !== undefined) {
      currentSkills.splice(Number(d.removeSkill), 1);
      return renderSkills();
    }
    if (d.deletePortfolio) return deletePortfolio(Number(d.deletePortfolio));
    if ("back" in d) {
      activeThreadId = null;
      return renderMessages();
    }
  });

  restoreSession();
});

/* Start (or continue) a conversation with a user, even before any message exists. */
function openThreadWith(userId) {
  const u = store.users.find((x) => x.id === userId);
  if (!u) return;
  if (!buildThreads().some((t) => t.otherId === userId)) {
    // Render a fresh, empty conversation so the client can write first.
    activeThreadId = userId;
    showPage("messages");
    $("chat").classList.add("show-conv");
    $("conversation").innerHTML = `
      <div class="conv-head">
        <button class="icon-btn back" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 4.5 8.5 11l6.5 6.5-1.4 1.4L5.7 11l7.9-7.9z"/></svg></button>
        ${avatarHTML(u.name)}
        <div><strong>${escapeHTML(u.name)}</strong><span>${escapeHTML(u.role)}${u.title ? " · " + escapeHTML(u.title) : ""}</span></div>
      </div>
      <div class="bubbles"><div class="empty"><strong>Say hello</strong><span>Start the conversation with ${escapeHTML(u.name.split(" ")[0])}.</span></div></div>
      <form class="composer" id="composer">
        <textarea id="composerInput" rows="1" placeholder="Message ${escapeHTML(u.name.split(" ")[0])}"></textarea>
        <button type="submit" class="send" aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M3 11.5 21 3l-4 18-5.5-6.5zM11 13l3.5 4.5L18 6.5 6 11z"/></svg></button>
      </form>`;
    const input = $("composerInput");
    const send = $("composer").querySelector(".send");
    input.addEventListener("input", () => (send.disabled = !input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("composer").requestSubmit();
      }
    });
    $("composer").addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage(u.id, u.name, input.value);
    });
    input.focus();
    return;
  }
  openThread(userId);
}
