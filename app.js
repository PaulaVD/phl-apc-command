
(() => {
  "use strict";

  const STORAGE_KEY = "phl_apex_console_v7";
  const PREFS_KEY = "phl_prefs_v1";
  const ADMIN_SESSION_KEY = "phl_admin_session_v3";
  const LEGACY_ADMIN_SESSION_KEYS = ["phl_admin_session_v1", "phl_admin_session_v2"];
  const MEMBER_SESSION_KEY = "phl_member_session_v1";
  const OUTBOX_KEY = "phl_cloud_outbox_v1";
  const HISTORY_KEY = "phl_roster_history_v1";
  const PERSONAL_CODE_PREF_KEY = "phl_my_personal_codes_v1";
  const ADMIN_HEARTBEAT_MS = 10_000;
  const APC_COUNT = 4;
  /** APC1–APC3 required on submit; APC4 is optional and can be toggled off per member. */
  const REQUIRED_APC_COUNT = 3;
  /** Soft ceiling only — never use HQ band max to block real saved CP values. */
  const APC_CP_STORE_MAX = 99999;
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const HISTORY_CAP = 300;
  const MOBILE_MQ = "(max-width: 900px)";
  const MOBILE_HINT_KEY = "phl_mobile_tab_hint_v1";
  const PERSONAL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  /** One real upload is enough to start live RL/RJ from actual CP. */
  const MIN_RALLY_ROSTER_SAMPLES = 1;
  const ASSETS = { apc: "assets/phl-apc.png?v=2", logo: "assets/phl-logo.png?v=2" };
  const TOWER_LEVELS = Array.from({ length: 30 }, (_, i) => `WT${i + 1}`);
  const INDUSTRY_LEVELS = Array.from({ length: 12 }, (_, i) => `I${i + 1}`);
  const RANKS = ["R1", "R2", "R3", "R4", "R5"];
  const FACTIONS = ["Fighter", "Shooter", "Rider", "Mixed"];
  const PRESETS = [25, 50, 100, 250, 500];
  const BANDS = buildInternalBands();
  const PARTICLE_COLORS = ["rgba(255,122,70,.88)", "rgba(240,186,114,.92)", "rgba(213,77,39,.82)"];
  const STATUS = {
    building: { label: "Building", color: "#ff9b6f", score: 35 },
    operational: { label: "Operational", color: "#f0ba72", score: 58 },
    frontline: { label: "Frontline", color: "#ff6f43", score: 78 },
    apex: { label: "Apex", color: "#ffe3a5", score: 100 }
  };
  const NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0
  });
  const LEVEL_OPTIONS = buildLevelOptions();
  const RANK_OPTIONS = RANKS.map(rank => `<option value="${rank}">${rank}</option>`).join("");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let roster = loadRoster();
  let changeHistory = loadHistory();
  let prefs = loadPrefs();
  let editingId = null;
  let currentStep = 0;
  let sfxEnabled = true;
  let adminSession = loadAdminSession();
  let isAdmin = Boolean(adminSession);
  let memberSession = isAdmin ? null : loadMemberSession();
  let isMember = Boolean(memberSession) && !isAdmin;
  let audioUnlocked = false;
  let pendingDeletedIds = new Set();
  let cloudSyncTimer = 0;
  let adminRealtimeTimer = 0;
  let adminRealtimeBusy = false;
  let lastCloudFingerprint = "";
  let lastAdminChatStamp = "";
  let rosterFilterTimer = 0;
  let rallyRosterTimer = 0;
  let rallyTeamExpanded = { rl: false, rj: false };
  let lastRenderedLevel = null;
  let wizardRailDirty = true;
  let lastWizardRailScrollStep = -1;
  let audioAvailable = true;
  let pendingDeleteId = null;
  let lastFocusedElement = null;
  let mobileTab = "times";
  let adminView = "roster";
  let drawerMemberId = null;
  let drawerField = null;
  let drawerSaving = false;
  let pendingPersonalCodeReveal = null;
  let scheduledEvents = [];
  let editingEventId = null;
  let eventsBusy = false;
  const kpiTweens = new WeakMap();

  const state = {
    name: "",
    level: prefs.lastLevel && BANDS[prefs.lastLevel] ? prefs.lastLevel : "WT30",
    rank: RANKS.includes(prefs.lastRank) ? prefs.lastRank : "R1",
    rallyCapacity: 0,
    personalCode: "",
    hasApc4: false,
    apcs: Array.from({ length: APC_COUNT }, () => ({ cp: 0, faction: "Fighter" }))
  };

  const stepMeta = [
    { key: "identity", title: "Operator identity", hint: "Start with the member name, level and alliance rank.", railTitle: "Identity", railHint: "Member info", icon: "01" },
    { key: "apc1", title: "APC 1 setup", hint: "Configure your main APC CP, faction and Rally Plaza capacity.", railTitle: "APC 1", railHint: "Main + Plaza", icon: "A1" },
    { key: "apc2", title: "APC 2 setup", hint: "Add the second APC and keep your loadout balanced.", railTitle: "APC 2", railHint: "Second APC", icon: "A2" },
    { key: "apc3", title: "APC 3 setup", hint: "Set the third APC power and faction focus.", railTitle: "APC 3", railHint: "Third APC", icon: "A3" },
    { key: "apc4", title: "APC 4 setup (optional)", hint: "Tick the box if you have a 4th APC. Leave it unchecked to skip.", railTitle: "APC 4", railHint: "Optional", icon: "A4" },
    { key: "review", title: "Review & save", hint: "Check the summary and save the member into the roster.", railTitle: "Review", railHint: "Finalize", icon: "06" }
  ];

  const el = {
    wizardRail: document.getElementById("wizardRail"),
    wizardLabel: document.getElementById("wizardLabel"),
    wizardTitle: document.getElementById("wizardTitle"),
    wizardHint: document.getElementById("wizardHint"),
    wizardIcon: document.getElementById("wizardIcon"),
    wizardContent: document.getElementById("wizardContent"),
    stepPill: document.getElementById("stepPill"),
    entryTitle: document.getElementById("entryTitle"),
    entrySubtitle: document.getElementById("entrySubtitle"),
    wizardShell: document.getElementById("wizardShell"),
    wizardCardHead: document.getElementById("wizardCardHead"),
    primaryBtn: document.getElementById("primaryBtn"),
    backBtn: document.getElementById("backBtn"),
    resetBtn: document.getElementById("resetBtn"),
    searchInput: document.getElementById("searchInput"),
    levelFilter: document.getElementById("levelFilter"),
    rankFilter: document.getElementById("rankFilter"),
    statusFilter: document.getElementById("statusFilter"),
    sortSelect: document.getElementById("sortSelect"),
    resultText: document.getElementById("resultText"),
    rosterList: document.getElementById("rosterList"),
    readinessGauge: document.getElementById("readinessGauge"),
    readinessValue: document.getElementById("readinessValue"),
    readinessCopy: document.getElementById("readinessCopy"),
    rankingList: document.getElementById("rankingList"),
    factionCoverage: document.getElementById("factionCoverage"),
    rallySplit: document.getElementById("rallySplit"),
    kpiRl: document.getElementById("kpiRl"),
    kpiRj: document.getElementById("kpiRj"),
    kpiRlBtn: document.getElementById("kpiRlBtn"),
    kpiRjBtn: document.getElementById("kpiRjBtn"),
    rallyRosterReadout: document.getElementById("rallyRosterReadout"),
    rallyReadoutApc: document.getElementById("rallyReadoutApc"),
    rallyReadoutSamples: document.getElementById("rallyReadoutSamples"),
    rallyRuleCopy: document.getElementById("rallyRuleCopy"),
    rallyTeamRl: document.getElementById("rallyTeamRl"),
    rallyTeamRj: document.getElementById("rallyTeamRj"),
    rallyLeaderList: document.getElementById("rallyLeaderList"),
    rallyJoinerList: document.getElementById("rallyJoinerList"),
    rallyFormationList: document.getElementById("rallyFormationList"),
    rallyMatchmaking: document.getElementById("rallyMatchmaking"),
    refList: document.getElementById("refList"),
    summaryStrip: document.getElementById("summaryStrip"),
    kpiMembers: document.getElementById("kpiMembers"),
    kpiAlliancePower: document.getElementById("kpiAlliancePower"),
    kpiAvgMain: document.getElementById("kpiAvgMain"),
    kpiApexCount: document.getElementById("kpiApexCount"),
    kpiApexTotal: document.getElementById("kpiApexTotal"),
    toastRegion: document.getElementById("toastRegion"),
    scanModeTag: document.getElementById("scanModeTag"),
    statusTag: document.getElementById("statusTag"),
    sfxBtn: document.getElementById("sfxBtn"),
    lofiPlayer: document.getElementById("lofiPlayer"),
    lofiNowBtn: document.getElementById("lofiNowBtn"),
    lofiTrackTitle: document.getElementById("lofiTrackTitle"),
    lofiTrackArtist: document.getElementById("lofiTrackArtist"),
    lofiPrevBtn: document.getElementById("lofiPrevBtn"),
    lofiPlayBtn: document.getElementById("lofiPlayBtn"),
    lofiNextBtn: document.getElementById("lofiNextBtn"),
    lofiVolume: document.getElementById("lofiVolume"),
    lofiPlaylist: document.getElementById("lofiPlaylist"),
    adminAccessBtn: document.getElementById("signInBtn"),
    adminAccessLabel: document.getElementById("signInLabel"),
    signInBtn: document.getElementById("signInBtn"),
    signInLabel: document.getElementById("signInLabel"),
    authModal: document.getElementById("authModal"),
    authModalTitle: document.getElementById("authModalTitle"),
    authModalLead: document.getElementById("authModalLead"),
    accessCodeInput: document.getElementById("accessCodeInput"),
    authUnlockBtn: document.getElementById("authUnlockBtn"),
    authCancelBtn: document.getElementById("authCancelBtn"),
    authError: document.getElementById("authError"),
    adminModal: document.getElementById("authModal"),
    adminCodeInput: document.getElementById("accessCodeInput"),
    adminLoginBtn: document.getElementById("authUnlockBtn"),
    adminCancelBtn: document.getElementById("authCancelBtn"),
    adminError: document.getElementById("authError"),
    memberAccessBtn: document.getElementById("signInBtn"),
    memberAccessLabel: document.getElementById("signInLabel"),
    memberModal: document.getElementById("authModal"),
    memberCodeInput: document.getElementById("accessCodeInput"),
    memberLoginBtn: document.getElementById("authUnlockBtn"),
    memberCancelBtn: document.getElementById("authCancelBtn"),
    memberError: document.getElementById("authError"),
    memberProfilePanel: document.getElementById("memberProfilePanel"),
    memberProfileTitle: document.getElementById("memberProfileTitle"),
    memberProfileSub: document.getElementById("memberProfileSub"),
    memberProfileResult: document.getElementById("memberProfileResult"),
    memberProfileList: document.getElementById("memberProfileList"),
    memberLogoutBtn: document.getElementById("memberLogoutBtn"),
    adminCommsPanel: document.getElementById("adminCommsPanel"),
    adminOnlineCount: document.getElementById("adminOnlineCount"),
    adminOnlineList: document.getElementById("adminOnlineList"),
    adminChatLog: document.getElementById("adminChatLog"),
    adminChatForm: document.getElementById("adminChatForm"),
    adminChatInput: document.getElementById("adminChatInput"),
    adminChatSend: document.getElementById("adminChatSend"),
    deleteModal: document.getElementById("deleteModal"),
    deleteModalText: document.getElementById("deleteModalText"),
    deleteConfirmBtn: document.getElementById("deleteConfirmBtn"),
    deleteCancelBtn: document.getElementById("deleteCancelBtn"),
    syncModal: document.getElementById("syncModal"),
    syncStatusText: document.getElementById("syncStatusText"),
    syncError: document.getElementById("syncError"),
    syncPullBtn: document.getElementById("syncPullBtn"),
    syncPushBtn: document.getElementById("syncPushBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    importJsonInput: document.getElementById("importJsonInput"),
    syncCloseBtn: document.getElementById("syncCloseBtn"),
    scanPanel: document.getElementById("scanPanel"),
    scanToggleBtn: document.getElementById("scanToggleBtn"),
    liveBadge: document.getElementById("liveBadge"),
    scanMain: document.getElementById("scanMain"),
    scanTotal: document.getElementById("scanTotal"),
    scanAverage: document.getElementById("scanAverage"),
    scanGap: document.getElementById("scanGap"),
    scanRallyRole: document.getElementById("scanRallyRole"),
    scanLevelLabel: document.getElementById("scanLevelLabel"),
    orbitValues: [
      document.getElementById("orbit1"),
      document.getElementById("orbit2"),
      document.getElementById("orbit3"),
      document.getElementById("orbit4")
    ],
    orbitFactions: [
      document.getElementById("orbitFaction1"),
      document.getElementById("orbitFaction2"),
      document.getElementById("orbitFaction3"),
      document.getElementById("orbitFaction4")
    ],
    mobileShellTabs: document.getElementById("mobileShellTabs"),
    eventsMenu: document.getElementById("eventsMenu"),
    eventsTabBtn: document.getElementById("eventsTabBtn"),
    eventsPopover: document.getElementById("eventsPopover"),
    eventsPopoverClose: document.getElementById("eventsPopoverClose"),
    eventsTabCount: document.getElementById("eventsTabCount"),
    teScheduleList: document.getElementById("teScheduleList"),
    teScheduleEmpty: document.getElementById("teScheduleEmpty"),
    teAdminSchedule: document.getElementById("teAdminSchedule"),
    teEventForm: document.getElementById("teEventForm"),
    teEventDate: document.getElementById("teEventDate"),
    teEventTime: document.getElementById("teEventTime"),
    teEventTitle: document.getElementById("teEventTitle"),
    teEventNote: document.getElementById("teEventNote"),
    teEventSaveBtn: document.getElementById("teEventSaveBtn"),
    teEventCancelBtn: document.getElementById("teEventCancelBtn"),
    memberDrawer: document.getElementById("memberDrawer"),
    memberDrawerBody: document.getElementById("memberDrawerBody"),
    memberDrawerTitle: document.getElementById("memberDrawerTitle"),
    memberDrawerSub: document.getElementById("memberDrawerSub"),
    memberDrawerEyebrow: document.getElementById("memberDrawerEyebrow"),
    memberDrawerSave: document.getElementById("memberDrawerSave"),
    memberDrawerCancel: document.getElementById("memberDrawerCancel"),
    memberDrawerClose: document.getElementById("memberDrawerClose"),
    personalCodeModal: document.getElementById("personalCodeModal"),
    personalCodeReveal: document.getElementById("personalCodeReveal"),
    personalCodeCopyBtn: document.getElementById("personalCodeCopyBtn"),
    personalCodeCloseBtn: document.getElementById("personalCodeCloseBtn"),
    adminRosterPane: document.getElementById("adminRosterPane"),
    adminHistoryPane: document.getElementById("adminHistoryPane"),
    historyList: document.getElementById("historyList"),
    historyResultText: document.getElementById("historyResultText"),
    historyRefreshBtn: document.getElementById("historyRefreshBtn"),
    sessionBanner: document.getElementById("sessionBanner")
  };

  const audio = {};
  const audioFiles = {
    click: "assets/ui-click.wav",
    transition: "assets/ui-transition.wav",
    success: "assets/ui-success.wav",
    error: "assets/ui-error.wav"
  };

  const LOFI_PLAYLIST = [
    { title: "beats to relax/study to", artist: "Lofi Girl · hip hop", youtubeId: "X4VbdwhkE10" },
    { title: "beats to sleep/chill to", artist: "Lofi Girl · sleep", youtubeId: "JD-kMIpDfnY" },
    { title: "jazz lofi radio", artist: "Lofi Girl · jazz", youtubeId: "E2vONfzoyRI" },
    { title: "synthwave radio", artist: "Lofi Girl · synthwave", youtubeId: "4xDzrJKXOOY" },
    { title: "asian lofi radio", artist: "Lofi Girl · asian", youtubeId: "1Tl2FtV06qo" },
    { title: "sad lofi radio", artist: "Lofi Girl · rainy days", youtubeId: "CwPCy1GLS38" },
    { title: "relaxing piano radio", artist: "Lofi Girl · piano", youtubeId: "N0snMcR6aaA" },
    { title: "dark ambient radio", artist: "Lofi Girl · ambient", youtubeId: "S_MOd40zlYU" },
    { title: "Study With Me · Pomodoro", artist: "Lofi Girl · focus", youtubeId: "qGohtGC5Rtk" }
  ];

  let lofiIndex = Number.isFinite(prefs.lofiIndex)
    ? Math.max(0, Math.min(LOFI_PLAYLIST.length - 1, Math.floor(Number(prefs.lofiIndex))))
    : 0;
  let lofiPlaying = false;
  let lofiPlayerYt = null;
  let lofiYtReady = false;
  let lofiPendingPlay = false;
  let lofiVolumePct = (() => {
    const saved = Number(prefs.lofiVolume);
    if (Number.isFinite(saved) && saved > 0 && saved <= 1) return Math.round(saved * 100);
    if (Number.isFinite(saved) && saved > 1 && saved <= 100) return Math.round(saved);
    return 55;
  })();

  init();

  function init() {
    el.levelFilter.innerHTML = `<option value="all">All levels</option>${LEVEL_OPTIONS}`;
    enforceLocalRosterScope();
    bindEvents();
    initLofiPlayer();
    applyAccessMode();
    initMobileTabs();
    maybeWarnStaleSessions();
    enhanceSelects(document.querySelector(".toolbar"));
    initServerClockPanel();
    if (el.teEventDate && !el.teEventDate.value) el.teEventDate.value = todayServerDate();
    renderAll();
    pullScheduledEvents({ silent: true });
    probeAudioAssets();
    if (!reducedMotion) startParticles();
    enableTilt(document.querySelector(".scan-panel[data-tilt]"));
    if (window.matchMedia(MOBILE_MQ).matches) {
      setScanPanelCollapsed(true);
    }
    if (isCloudConfigured()) {
      flushCloudOutbox()
        .then(() => {
          if (isAdmin) return pullCloudRoster({ silent: true });
          if (isMember) return pullMemberSelf({ silent: true });
          return Promise.resolve();
        })
        .then(() => startCloudSyncLoop())
        .catch(() => startCloudSyncLoop());
    }
    if (isAdmin) {
      startAdminRealtime({ claim: true });
    }
  }

  function bindEvents() {
    el.primaryBtn.addEventListener("click", () => nextStep());
    el.backBtn.addEventListener("click", prevStep);
    el.resetBtn.addEventListener("click", () => resetForm(true));
    el.syncCloseBtn?.addEventListener("click", () => closeModal("sync"));
    el.syncPullBtn?.addEventListener("click", () => pullCloudRoster({ silent: false }));
    el.syncPushBtn?.addEventListener("click", () => pushCloudRosterWithRetry({ silent: false }));
    el.exportJsonBtn?.addEventListener("click", exportJsonRoster);
    el.importJsonInput?.addEventListener("change", importJsonRoster);
    el.searchInput.addEventListener("input", scheduleRosterRender);
    el.levelFilter.addEventListener("change", renderRoster);
    el.rankFilter?.addEventListener("change", renderRoster);
    el.statusFilter.addEventListener("change", renderRoster);
    el.sortSelect.addEventListener("change", renderRoster);
    el.sfxBtn.addEventListener("click", () => {
      unlockAudio();
      sfxEnabled = !sfxEnabled;
      el.sfxBtn.classList.toggle("active", sfxEnabled);
      playSfx("click");
    });
    el.signInBtn?.addEventListener("click", handleSignInAccess);
    el.authUnlockBtn?.addEventListener("click", attemptUnlock);
    el.authCancelBtn?.addEventListener("click", () => closeModal("auth"));
    el.memberLogoutBtn?.addEventListener("click", () => logoutMemberSession());
    el.adminChatForm?.addEventListener("submit", onAdminChatSubmit);
    document.querySelectorAll("[data-modal-close]").forEach(node => {
      node.addEventListener("click", () => closeModal(node.dataset.modalClose));
    });
    el.deleteConfirmBtn.addEventListener("click", confirmDeleteMember);
    el.deleteCancelBtn.addEventListener("click", () => closeModal("delete"));
    el.scanToggleBtn?.addEventListener("click", toggleScanPanel);
    el.kpiRlBtn?.addEventListener("click", () => toggleRallyTeamPanel("rl"));
    el.kpiRjBtn?.addEventListener("click", () => toggleRallyTeamPanel("rj"));
    el.accessCodeInput?.addEventListener("keydown", event => { if (event.key === "Enter") attemptUnlock(); });
    el.memberDrawerSave?.addEventListener("click", () => { void saveMemberDrawer(); });
    el.memberDrawerClose?.addEventListener("click", closeMemberDrawer);
    el.memberDrawerCancel?.addEventListener("click", closeMemberDrawer);
    el.personalCodeCopyBtn?.addEventListener("click", copyRevealedPersonalCode);
    el.historyRefreshBtn?.addEventListener("click", () => {
      pullCloudRoster({ silent: false }).then(() => renderHistory());
    });
    el.teEventForm?.addEventListener("submit", onScheduledEventSubmit);
    el.teEventCancelBtn?.addEventListener("click", resetScheduledEventForm);
    el.eventsTabBtn?.addEventListener("click", event => {
      event.stopPropagation();
      toggleEventsPopover();
    });
    el.eventsPopoverClose?.addEventListener("click", () => setEventsPopoverOpen(false));
    document.addEventListener("click", event => {
      if (!el.eventsPopover || el.eventsPopover.hidden) return;
      if (el.eventsMenu?.contains(event.target)) return;
      setEventsPopoverOpen(false);
    });
    document.querySelectorAll("[data-admin-view]").forEach(btn => {
      btn.addEventListener("click", () => setAdminView(btn.dataset.adminView));
    });
    document.querySelectorAll("[data-drawer-close]").forEach(node => {
      node.addEventListener("click", closeMemberDrawer);
    });
    document.querySelectorAll("[data-drawer-save-close]").forEach(node => {
      node.addEventListener("click", () => { void saveMemberDrawer(); });
    });
    document.addEventListener("click", onDynamicClick);
    document.addEventListener("input", onDynamicInput);
    document.addEventListener("click", closeUiSelectsOnOutsideClick);
    window.addEventListener("keydown", onGlobalKeydown);
  }

  function onGlobalKeydown(event) {
    if (event.key === "Escape") {
      closeAllUiSelects();
      if (el.eventsPopover && !el.eventsPopover.hidden) setEventsPopoverOpen(false);
      else if (el.memberDrawer?.classList.contains("open")) closeMemberDrawer();
      else if (el.personalCodeModal?.classList.contains("open")) closeModal("personalCode");
      else if (el.authModal?.classList.contains("open")) closeModal("auth");
      else if (el.deleteModal.classList.contains("open")) closeModal("delete");
      else if (el.syncModal?.classList.contains("open")) closeModal("sync");
      return;
    }
    if (event.key === "Enter" && el.memberDrawer?.classList.contains("open") && drawerField) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT") {
        event.preventDefault();
        void saveMemberDrawer();
      }
      return;
    }
    if (document.body.classList.contains("modal-open")) return;
    if (event.key !== "Enter") return;

    const target = event.target;
    const tag = target.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A" || target.isContentEditable) return;
    if (document.querySelector(".ui-select.is-open")) return;
    if (tag !== "INPUT" && tag !== "SELECT") return;

    event.preventDefault();
    nextStep();
  }

  function syncMobileLofiHost() {
    /* Lofi stays in the header; Times panel host removed. */
  }

  function initMobileTabs() {
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => {
      const isMobile = mq.matches;
      document.documentElement.classList.toggle("is-mobile-shell", isMobile);
      document.body.classList.remove("mobile-tab-times", "mobile-tab-preview");
      document.body.classList.toggle("mobile-tab-push", isMobile);
      const hint = document.getElementById("mobileTabHint");
      if (hint) hint.hidden = true;
    };
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else if (mq.addListener) mq.addListener(apply);
  }

  function maybeShowMobileTabHint() {
    /* Mobile Times tab removed — Events lives in the header. */
  }

  function setMobileTab() {
    /* no-op: schedule is header Events popover */
  }

  function setEventsPopoverOpen(open) {
    if (!el.eventsPopover || !el.eventsTabBtn) return;
    const next = Boolean(open);
    el.eventsPopover.hidden = !next;
    el.eventsTabBtn.setAttribute("aria-expanded", String(next));
    el.eventsTabBtn.classList.toggle("is-open", next);
    el.eventsMenu?.classList.toggle("is-open", next);
    if (next) {
      if (el.teEventDate && !el.teEventDate.value) el.teEventDate.value = todayServerDate();
      playSfx("click");
    }
  }

  function toggleEventsPopover() {
    const open = el.eventsPopover?.hidden !== false;
    setEventsPopoverOpen(open);
  }

  function updateEventsTabCount() {
    if (!el.eventsTabCount) return;
    const n = scheduledEvents.length;
    if (!n) {
      el.eventsTabCount.hidden = true;
      el.eventsTabCount.textContent = "0";
      return;
    }
    el.eventsTabCount.hidden = false;
    el.eventsTabCount.textContent = String(n);
  }

  function setSessionBanner(message, { actionLabel = "Sign in", onAction = null } = {}) {
    if (!el.sessionBanner) return;
    if (!message) {
      el.sessionBanner.hidden = true;
      el.sessionBanner.innerHTML = "";
      return;
    }
    el.sessionBanner.hidden = false;
    el.sessionBanner.innerHTML = `
      <span>${message}</span>
      ${onAction ? `<button type="button" class="btn btn-ghost session-banner-action" id="sessionBannerAction">${escapeHtml(actionLabel)}</button>` : ""}
      <button type="button" class="icon-btn session-banner-dismiss" id="sessionBannerDismiss" aria-label="Dismiss">×</button>`;
    el.sessionBanner.querySelector("#sessionBannerDismiss")?.addEventListener("click", () => setSessionBanner(""));
    if (onAction) {
      el.sessionBanner.querySelector("#sessionBannerAction")?.addEventListener("click", () => {
        setSessionBanner("");
        onAction();
      });
    }
  }

  function maybeWarnStaleSessions() {
    let hadLegacy = false;
    for (const key of LEGACY_ADMIN_SESSION_KEYS) {
      try {
        if (sessionStorage.getItem(key)) {
          sessionStorage.removeItem(key);
          hadLegacy = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (hadLegacy && !isAdmin) {
      setSessionBanner(
        "Your previous session is no longer valid. Sign in again.",
        { actionLabel: "Sign in", onAction: () => openAdminModal() }
      );
      toast("Admin session expired — please log in again.", "error");
    }
  }

  function setAdminView(view) {
    adminView = view === "history" ? "history" : "roster";
    document.querySelectorAll("[data-admin-view]").forEach(btn => {
      const active = btn.dataset.adminView === adminView;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    if (el.adminRosterPane) {
      el.adminRosterPane.hidden = adminView !== "roster";
      el.adminRosterPane.classList.toggle("is-active", adminView === "roster");
    }
    if (el.adminHistoryPane) {
      el.adminHistoryPane.hidden = adminView !== "history";
      el.adminHistoryPane.classList.toggle("is-active", adminView === "history");
    }
    if (adminView === "history") renderHistory();
    playSfx("click");
  }

  function setScanPanelCollapsed(collapsed) {
    if (!el.scanPanel || !el.scanToggleBtn) return;
    el.scanPanel.classList.toggle("is-collapsed", collapsed);
    el.scanToggleBtn.setAttribute("aria-expanded", String(!collapsed));
    el.scanToggleBtn.textContent = collapsed ? "Show scan" : "Hide scan";
  }

  function toggleScanPanel() {
    setScanPanelCollapsed(!el.scanPanel.classList.contains("is-collapsed"));
  }

  async function probeAudioAssets() {
    try {
      const response = await fetch("assets/ui-click.wav", { method: "HEAD", cache: "force-cache" });
      if (!response.ok) throw new Error("audio missing");
      audioAvailable = true;
    } catch {
      try {
        const response = await fetch("assets/ui-click.wav", { cache: "force-cache" });
        if (!response.ok) throw new Error("audio missing");
        audioAvailable = true;
      } catch {
        audioAvailable = false;
        sfxEnabled = false;
        el.sfxBtn.classList.remove("active");
        el.sfxBtn.disabled = true;
      }
    }
  }

  function scheduleRosterRender() {
    clearTimeout(rosterFilterTimer);
    rosterFilterTimer = window.setTimeout(renderRoster, 120);
  }

  function captureScrollState() {
    const panels = [];
    document.querySelectorAll(
      ".wizard-rail, .roster-list, .ranking-list, .history-list, .admin-chat-log, .te-schedule, .ref-list, .faction-coverage, .rally-formation-list"
    ).forEach(node => {
      panels.push({ node, top: node.scrollTop, left: node.scrollLeft });
    });
    return { x: window.scrollX, y: window.scrollY, panels };
  }

  function restoreScrollState(saved) {
    if (!saved) return;
    window.scrollTo(saved.x, saved.y);
    for (const panel of saved.panels) {
      if (!panel.node.isConnected) continue;
      panel.node.scrollTop = panel.top;
      panel.node.scrollLeft = panel.left;
    }
  }

  function withPreservedScroll(fn) {
    const saved = captureScrollState();
    try {
      return fn();
    } finally {
      restoreScrollState(saved);
      window.requestAnimationFrame(() => restoreScrollState(saved));
    }
  }

  function renderAll() {
    withPreservedScroll(() => {
      wizardRailDirty = true;
      renderWizard(true);
      renderScan();
      if (isAdmin) {
        renderSummaryStrip();
        renderRoster();
        renderReadiness();
        renderFactionCoverage();
        renderRallySplit();
        renderRanking();
        renderRefList(true);
        if (adminView === "history") renderHistory();
        clearMemberProfileUi();
      } else if (isMember) {
        clearAdminViews();
        renderMemberProfile();
      } else {
        clearAdminViews();
        clearMemberProfileUi();
      }
      syncLiveRallyClassification({ skipScan: true });
      renderScheduledEvents();
    });
  }

  function initServerClockPanel() {
    const mount = () => {
      const api = globalThis.PHL_SERVER_CLOCK;
      if (!api?.mountServerClock) return false;
      if (document.getElementById("serverClockDisplay")?.dataset.mounted === "1") return true;
      try {
        api.mountServerClock({
          clockEl: document.getElementById("serverClockDisplay"),
          serverBadgeEl: document.getElementById("serverClockBadge"),
          localClockEl: document.getElementById("localClockDisplay"),
          localOffsetBadgeEl: document.getElementById("localOffsetBadge"),
          localZoneLabelEl: document.getElementById("localZoneLabel"),
          offsetSelect: document.getElementById("localOffsetSelect"),
          eventInput: document.getElementById("serverEventInput"),
          resultEl: document.getElementById("localConvertedTime"),
          resultMetaEl: document.getElementById("localConvertedMeta")
        });
        const clock = document.getElementById("serverClockDisplay");
        if (clock) clock.dataset.mounted = "1";
        enhanceSelects(document.querySelector(".topbar"));
        return true;
      } catch (error) {
        console.warn("Server clock failed to mount:", error);
        return false;
      }
    };

    if (mount()) return;

    fetch(`serverClock.js?v=34&t=${Date.now()}`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(source => {
        // Classic <script src> is unreliable in some embeds; eval the module text.
        // eslint-disable-next-line no-new-func
        new Function(source)();
        if (!mount()) console.warn("Server clock API missing after load.");
      })
      .catch(error => console.warn("Could not load serverClock.js:", error));
  }

  function getEventsApiUrl() {
    return getConfig().eventsApiUrl || "";
  }

  function todayServerDate() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    } catch {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  function formatEventDate(date) {
    const raw = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
    try {
      const [y, m, d] = raw.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 15));
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
      }).format(dt);
    } catch {
      return raw;
    }
  }

  function normalizeEventRsvps(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      const status = String(value.status || "").toLowerCase();
      if (status !== "accepted" && status !== "declined") continue;
      out[String(key)] = {
        status,
        name: String(value.name || "").trim().slice(0, 40),
        updated: Number(value.updated) || 0
      };
    }
    return out;
  }

  function normalizeScheduledEvent(item) {
    if (!item || typeof item !== "object") return null;
    const id = String(item.id || "").trim();
    const time = String(item.time || "").trim();
    const title = String(item.title || item.label || "").trim();
    const date = String(item.date || "").trim();
    if (!id || !/^\d{2}:\d{2}$/.test(time) || !title) return null;
    return {
      id,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      time,
      title: title.slice(0, 80),
      note: String(item.note || "").trim().slice(0, 120),
      rsvps: normalizeEventRsvps(item.rsvps),
      updated: Number(item.updated) || 0,
      createdBy: String(item.createdBy || "").trim()
    };
  }

  function sortScheduledEvents(list) {
    return [...(list || [])].sort((a, b) => {
      const aDate = a.date || "9999-99-99";
      const bDate = b.date || "9999-99-99";
      const byDate = String(aDate).localeCompare(String(bDate));
      if (byDate) return byDate;
      const byTime = String(a.time).localeCompare(String(b.time));
      if (byTime) return byTime;
      return String(a.title).localeCompare(String(b.title));
    });
  }

  function myEventRsvpKey() {
    if (memberSession?.personalCode) return normalizePersonalCode(memberSession.personalCode);
    if (isAdmin && adminSession?.id) return `admin:${adminSession.id}`;
    return "";
  }

  function getMyEventRsvp(event) {
    const key = myEventRsvpKey();
    if (!key || !event?.rsvps) return null;
    return event.rsvps[key] || null;
  }

  function countEventRsvps(event) {
    const entries = Object.values(event?.rsvps || {});
    let accepted = 0;
    let declined = 0;
    for (const entry of entries) {
      if (entry.status === "accepted") accepted += 1;
      else if (entry.status === "declined") declined += 1;
    }
    return { accepted, declined };
  }

  function scheduledEventsFingerprint(list) {
    const me = myEventRsvpKey() || "anon";
    const mode = isAdmin ? "a" : isMember ? "m" : "p";
    return sortScheduledEvents(list)
      .map(event => {
        const mine = event.rsvps?.[me]?.status || "-";
        const counts = countEventRsvps(event);
        return `${event.id}:${event.date || ""}:${event.time}:${event.title}:${event.note || ""}:${counts.accepted}:${counts.declined}:${mine}:${mode}`;
      })
      .join("|");
  }

  function renderEventRsvpNames(event) {
    if (!isAdmin) return "";
    const accepted = [];
    const declined = [];
    for (const entry of Object.values(event.rsvps || {})) {
      const label = entry.name || "Member";
      if (entry.status === "accepted") accepted.push(label);
      else if (entry.status === "declined") declined.push(label);
    }
    if (!accepted.length && !declined.length) return "";
    const parts = [];
    if (accepted.length) parts.push(`In: ${accepted.join(", ")}`);
    if (declined.length) parts.push(`Out: ${declined.join(", ")}`);
    return `<small class="te-event-rsvp-names">${escapeHtml(parts.join(" · "))}</small>`;
  }

  function renderScheduledEvents() {
    updateEventsTabCount();
    if (!el.teScheduleList) return;
    const list = sortScheduledEvents(scheduledEvents);
    const nextFp = scheduledEventsFingerprint(list);
    if (el.teScheduleList.dataset.eventsFp === nextFp) return;
    el.teScheduleList.dataset.eventsFp = nextFp;
    if (!list.length) {
      const emptyHint = isAdmin
        ? "No events yet — schedule one below."
        : "No events yet. Officers post times here.";
      el.teScheduleList.innerHTML = `<p class="te-empty" id="teScheduleEmpty">${escapeHtml(emptyHint)}</p>`;
      el.teScheduleEmpty = document.getElementById("teScheduleEmpty");
      return;
    }
    el.teScheduleList.innerHTML = list.map(event => {
      const dateLabel = formatEventDate(event.date);
      const when = dateLabel
        ? `<b>${escapeHtml(dateLabel)}</b><span class="te-event-time">${escapeHtml(event.time)}</span>`
        : `<b>${escapeHtml(event.time)}</b>`;
      const note = event.note
        ? `<em>${escapeHtml(event.note)}</em>`
        : "";
      const counts = countEventRsvps(event);
      const mine = getMyEventRsvp(event);
      const myStatus = mine?.status || "";
      const adminActions = isAdmin
        ? `<div class="te-event-manage">
            <button class="btn btn-ghost" type="button" data-action="edit-event" data-id="${escapeHtml(event.id)}">Edit</button>
            <button class="btn btn-ghost" type="button" data-action="delete-event" data-id="${escapeHtml(event.id)}">Delete</button>
          </div>`
        : "";
      const rsvpActions = `
        <div class="te-event-rsvp">
          <div class="te-event-rsvp-counts">
            <span>${counts.accepted} in</span>
            <span>${counts.declined} out</span>
            ${myStatus ? `<span class="te-event-rsvp-mine is-${escapeHtml(myStatus)}">You: ${myStatus === "accepted" ? "in" : "out"}</span>` : ""}
          </div>
          <div class="te-event-rsvp-actions">
            <button class="btn btn-ghost te-rsvp-accept ${myStatus === "accepted" ? "is-active" : ""}" type="button" data-action="rsvp-event" data-id="${escapeHtml(event.id)}" data-status="accepted">Accept</button>
            <button class="btn btn-ghost te-rsvp-decline ${myStatus === "declined" ? "is-active" : ""}" type="button" data-action="rsvp-event" data-id="${escapeHtml(event.id)}" data-status="declined">Decline</button>
          </div>
          ${renderEventRsvpNames(event)}
        </div>`;
      return `<div class="te-event">
        <div class="te-event-when">${when}</div>
        <div class="te-event-body">
          <span>${escapeHtml(event.title)}</span>
          ${note}
          ${rsvpActions}
        </div>
        ${adminActions}
      </div>`;
    }).join("");
  }

  function resetScheduledEventForm() {
    editingEventId = null;
    if (el.teEventDate) el.teEventDate.value = todayServerDate();
    if (el.teEventTime) el.teEventTime.value = "15:00";
    if (el.teEventTitle) el.teEventTitle.value = "";
    if (el.teEventNote) el.teEventNote.value = "";
    if (el.teEventSaveBtn) el.teEventSaveBtn.textContent = "Add event";
    if (el.teEventCancelBtn) el.teEventCancelBtn.hidden = true;
  }

  function beginEditScheduledEvent(id) {
    if (!isAdmin) return;
    const event = scheduledEvents.find(item => item.id === id);
    if (!event) return;
    editingEventId = event.id;
    if (el.teEventDate) el.teEventDate.value = event.date || todayServerDate();
    if (el.teEventTime) el.teEventTime.value = event.time;
    if (el.teEventTitle) el.teEventTitle.value = event.title;
    if (el.teEventNote) el.teEventNote.value = event.note || "";
    if (el.teEventSaveBtn) el.teEventSaveBtn.textContent = "Save event";
    if (el.teEventCancelBtn) el.teEventCancelBtn.hidden = false;
    el.teAdminSchedule?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.teEventTitle?.focus();
    playSfx("click");
  }

  async function pullScheduledEvents({ silent = true } = {}) {
    const url = getEventsApiUrl();
    if (!url) {
      scheduledEvents = [];
      renderScheduledEvents();
      return false;
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Events fetch failed (${response.status})`);
      const data = await response.json();
      scheduledEvents = sortScheduledEvents(
        (Array.isArray(data?.events) ? data.events : [])
          .map(normalizeScheduledEvent)
          .filter(Boolean)
      );
      renderScheduledEvents();
      return true;
    } catch (error) {
      if (!silent) toast(error?.message || "Could not load events.", "error");
      return false;
    }
  }

  async function postScheduledEvent(payload) {
    const url = getEventsApiUrl();
    if (!url) throw new Error("Events API not configured");
    if (!isAdmin || !adminSession?.id || !adminSession?.code) {
      throw new Error("Admin session required");
    }
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: getRosterAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Events save failed (${response.status})`);
    }
    scheduledEvents = sortScheduledEvents(
      (Array.isArray(data?.events) ? data.events : [])
        .map(normalizeScheduledEvent)
        .filter(Boolean)
    );
    renderScheduledEvents();
    return data;
  }

  async function postEventRsvp(id, status) {
    const url = getEventsApiUrl();
    if (!url) throw new Error("Events API not configured");
    if (!isAdmin && !isMember) {
      throw new Error("Sign in required");
    }
    const name = isMember
      ? (memberSession?.name || "")
      : (adminSession?.name || "");
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: getRosterAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        action: "rsvp",
        id,
        status,
        name
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `RSVP failed (${response.status})`);
    }
    scheduledEvents = sortScheduledEvents(
      (Array.isArray(data?.events) ? data.events : [])
        .map(normalizeScheduledEvent)
        .filter(Boolean)
    );
    renderScheduledEvents();
    return data;
  }

  async function onScheduledEventSubmit(event) {
    event.preventDefault();
    if (!isAdmin || eventsBusy) return;
    const date = String(el.teEventDate?.value || "").trim();
    const time = String(el.teEventTime?.value || "").trim();
    const title = String(el.teEventTitle?.value || "").trim();
    const note = String(el.teEventNote?.value || "").trim();
    if (!date || !time || !title) {
      toast("Date, time, and title are required.", "error");
      playSfx("error");
      return;
    }
    eventsBusy = true;
    if (el.teEventSaveBtn) el.teEventSaveBtn.disabled = true;
    const wasEdit = Boolean(editingEventId);
    try {
      await postScheduledEvent({
        action: "upsert",
        event: {
          id: editingEventId || undefined,
          date,
          time,
          title,
          note
        }
      });
      resetScheduledEventForm();
      toast(wasEdit ? "Event updated." : "Event scheduled.", "success");
      playSfx("success");
    } catch (error) {
      toast(error?.message || "Could not save event.", "error");
      playSfx("error");
    } finally {
      eventsBusy = false;
      if (el.teEventSaveBtn) el.teEventSaveBtn.disabled = false;
    }
  }

  async function deleteScheduledEvent(id) {
    if (!isAdmin || !id || eventsBusy) return;
    if (!window.confirm("Delete this scheduled event?")) return;
    eventsBusy = true;
    try {
      await postScheduledEvent({ action: "delete", id });
      if (editingEventId === id) resetScheduledEventForm();
      toast("Event deleted.", "success");
      playSfx("success");
    } catch (error) {
      toast(error?.message || "Could not delete event.", "error");
      playSfx("error");
    } finally {
      eventsBusy = false;
    }
  }

  async function rsvpScheduledEvent(id, status) {
    if (!id || eventsBusy) return;
    if (!isAdmin && !isMember) {
      openAuthModal();
      toast("Sign in with your Personal Code to accept or decline.", "error");
      playSfx("error");
      return;
    }
    eventsBusy = true;
    try {
      await postEventRsvp(id, status);
      toast(status === "accepted" ? "You're in for this event." : "Declined — you're out.", "success");
      playSfx("success");
    } catch (error) {
      toast(error?.message || "Could not update RSVP.", "error");
      playSfx("error");
    } finally {
      eventsBusy = false;
    }
  }

  /** Scroll active rail item horizontally inside the rail only — never the window. */
  function scrollWizardRailActiveIntoView() {
    const rail = el.wizardRail;
    const active = rail?.querySelector(".rail-item.active");
    if (!rail || !active) return;
    const railRect = rail.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const delta = ((itemRect.left + itemRect.right) - (railRect.left + railRect.right)) / 2;
    if (Math.abs(delta) > 1) rail.scrollLeft += delta;
  }

  function renderWizard(forceRail = false) {
    const meta = stepMeta[currentStep];
    const stepChanged = lastWizardRailScrollStep !== currentStep;
    updateWizardMeta(meta);

    if (forceRail || wizardRailDirty) {
      el.wizardRail.innerHTML = stepMeta.map((step, index) => `
        <button class="rail-item ${index < currentStep ? "done" : ""} ${index === currentStep ? "active" : ""}" type="button" data-go-step="${index}"${index === currentStep ? ' aria-current="step"' : ""}>
          <div class="rail-index">${step.icon}</div>
          <div><strong>${step.railTitle || step.title}</strong><span>${step.railHint}</span></div>
        </button>`).join("");
      wizardRailDirty = false;
    } else {
      el.wizardRail.querySelectorAll(".rail-item").forEach((node, index) => {
        node.classList.toggle("done", index < currentStep);
        node.classList.toggle("active", index === currentStep);
        if (index === currentStep) node.setAttribute("aria-current", "step");
        else node.removeAttribute("aria-current");
      });
    }
    // Only nudge the horizontal rail when the wizard step actually changes.
    // scrollIntoView here was resetting window scroll on every cloud sync re-render.
    if (stepChanged) {
      lastWizardRailScrollStep = currentStep;
      window.requestAnimationFrame(scrollWizardRailActiveIntoView);
    }

    if (meta.key === "identity") renderIdentityStep();
    else if (meta.key.startsWith("apc")) renderApcStep(Number(meta.key.slice(3)) - 1);
    else renderReviewStep();
    enhanceSelects(el.wizardContent);
  }

  function updateWizardMeta(meta = stepMeta[currentStep]) {
    const stepNumber = currentStep + 1;
    el.stepPill.textContent = `Step ${stepNumber} / ${stepMeta.length}`;
    el.wizardLabel.textContent = `Step ${stepNumber}`;
    el.wizardTitle.textContent = meta.title;
    el.wizardHint.textContent = currentStep === stepMeta.length - 1 && !isAdmin
      ? "Check the summary and submit your APC CP for PH-L admins to review."
      : meta.hint;
    el.wizardIcon.textContent = meta.icon;
    el.primaryBtn.textContent = currentStep === stepMeta.length - 1
      ? (editingId
        ? (isAdmin ? "Update roster" : "Update submission")
        : (isAdmin ? "Save to roster" : "Submit APC CP"))
      : "Continue";
    el.backBtn.disabled = currentStep === 0;
    el.backBtn.style.opacity = currentStep === 0 ? ".55" : "1";
  }

  function renderIdentityStep() {
    const band = BANDS[state.level];
    const role = classifyCurrentState();
    const remembered = recallPersonalCodeHint();
    el.wizardContent.innerHTML = `
      <div class="field-grid identity-grid">
        <div class="field"><label for="memberNameInput">Player name</label><input class="input" id="memberNameInput" type="text" maxlength="30" autocomplete="nickname" placeholder="Example: PlayerOne" value="${escapeHtml(state.name)}"></div>
        <div class="field"><label for="memberLevelInput">Level</label><select id="memberLevelInput">${levelOptionsHtml(state.level)}</select></div>
        <div class="field"><label for="memberRankInput">PH-L rank</label><select id="memberRankInput">${rankOptionsHtml(state.rank)}</select></div>
        <div class="field"><label for="rallyCapacityInput">Rally Plaza capacity</label><input class="input" id="rallyCapacityInput" type="number" min="0" step="1000" inputmode="numeric" placeholder="Troops, e.g. 400000" value="${state.rallyCapacity || ""}"></div>
        <div class="field personal-code-field" style="grid-column:1/-1">
          <label for="personalCodeInput">Personal Code</label>
          <input class="input" id="personalCodeInput" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Leave blank on first submit" value="${escapeHtml(state.personalCode)}">
          <small class="personal-code-help">
            <strong>First time:</strong> leave blank → we generate your code and show a “Save this code” popup.<br>
            <strong>Returning:</strong> enter your code to overwrite your entry.
            ${remembered ? ` Last on this device: <strong>${escapeHtml(remembered)}</strong>.` : ""}
          </small>
        </div>
      </div>
      <div class="helper-grid">
        <div class="helper-card">
          <span>PH-L internal benchmark</span>
          <div class="benchmark-values">
            <div class="benchmark-card"><strong>${band.operational}M</strong><small>Operational</small></div>
            <div class="benchmark-card"><strong>${band.frontline}M</strong><small>Frontline</small></div>
            <div class="benchmark-card"><strong>${band.apex}M</strong><small>Apex</small></div>
          </div>
          <div class="quick-row">
            <button class="quick-btn" type="button" data-fill-rank="R1">Quick rank R1</button>
            <button class="quick-btn" type="button" data-fill-rank="R3">Quick rank R3</button>
            <button class="quick-btn" type="button" data-fill-rank="R5">Quick rank R5</button>
          </div>
        </div>
        <div class="helper-card">
          <span>Live checklist</span>
          ${rallyGateWaitingNoteHtml()}
          <div class="summary-stack">
            <div class="summary-line"><span>Name entered</span><b data-checklist="name">${state.name.trim() ? "Yes" : "No"}</b></div>
            <div class="summary-line"><span>Level selected</span><b data-checklist="level">${formatLevel(state.level)}</b></div>
            <div class="summary-line"><span>Rank selected</span><b data-checklist="rank">${state.rank}</b></div>
            <div class="summary-line"><span>Plaza capacity</span><b data-checklist="plaza">${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
            <div class="summary-line"><span>Rally role</span><b data-checklist="role" data-live-rally-role class="${role.pending ? "" : (role.assigned_role === "RL" ? "gap-met" : "gap-short")}">${role.pending ? "Waiting" : (role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner")}</b></div>
            <div class="summary-line"><span>Role gate</span><b data-live-rally-reason>${escapeHtml(formatRallyGateReasonForChecklist())}</b></div>
            <div class="summary-line"><span>Main gap</span><b data-checklist="gap">${formatGap(getFrontlineGap(state.level, state.apcs[0].cp))}</b></div>
          </div>
        </div>
      </div>`;
  }

  function renderApcStep(index) {
    const apc = state.apcs[index];
    const max = getMaxForLevel(state.level);
    const gap = getFrontlineGap(state.level, apc.cp);
    const band = BANDS[state.level];
    const role = classifyCurrentState();
    const optional = index >= REQUIRED_APC_COUNT;
    const apc4On = !optional || Boolean(state.hasApc4);
    el.wizardContent.innerHTML = `
      <div class="apc-focus">
        <div class="apc-preview" data-tilt>
          <div class="mini-grid"></div>
          <div class="floating-id">APC ${index + 1}${optional ? " · Optional" : ""}</div>
          <img class="game-asset" src="${ASSETS.apc}" alt="APC ${index + 1} preview" width="240" height="180" decoding="async">
        </div>
        <div class="apc-editor">
          ${optional ? `
          <label class="apc4-enable-row">
            <input type="checkbox" id="wizardHasApc4" ${state.hasApc4 ? "checked" : ""}>
            <span>
              <strong>I have a 4th APC</strong>
              <small>Uncheck to skip APC 4. Totals and RL/RJ will ignore it.</small>
            </span>
          </label>` : ""}
          <div class="apc4-editor-body${!apc4On ? " is-disabled" : ""}" ${!apc4On ? 'aria-disabled="true"' : ""}>
          <div class="field"><span>Faction focus${optional ? " <em class=\"optional-tag\">optional</em>" : ""}</span></div>
          <div class="faction-row">
            ${FACTIONS.map(f => `<button class="seg-btn ${apc.faction === f ? "active" : ""}" type="button" data-apc-index="${index}" data-faction="${f}" ${!apc4On ? "disabled" : ""}>${f}</button>`).join("")}
          </div>
          <div class="cp-control">
            <button class="mini-btn" type="button" data-apc-index="${index}" data-step="-10" ${!apc4On ? "disabled" : ""}>-10</button>
            <div class="value-wrap">
              <input class="cp-input" id="cpInput${index}" data-apc-index="${index}" type="number" min="0" max="${APC_CP_STORE_MAX}" step="any" value="${apc.cp}" aria-label="APC ${index + 1} CP${optional ? " (optional)" : ""}" ${!apc4On ? "disabled" : ""}>
              <b>M CP</b>
            </div>
            <button class="mini-btn" type="button" data-apc-index="${index}" data-step="10" ${!apc4On ? "disabled" : ""}>+10</button>
          </div>
          <input class="slider" id="slider${index}" data-apc-index="${index}" type="range" min="0" max="${max}" step="1" value="${apc.cp}" aria-label="APC ${index + 1} combat power" ${!apc4On ? "disabled" : ""}>
          <div class="preset-row">
            ${PRESETS.map(value => `<button class="preset${value > max ? " is-disabled" : ""}${apc.cp === value ? " is-active" : ""}" type="button" data-apc-index="${index}" data-preset="${value}" ${value > max || !apc4On ? "disabled" : ""}>${value}M</button>`).join("")}
            <button class="preset" type="button" data-apc-index="${index}" data-preset="${band.frontline}" ${!apc4On ? "disabled" : ""}>Frontline ${band.frontline}M</button>
            <button class="preset" type="button" data-apc-index="${index}" data-preset="${band.apex}" ${!apc4On ? "disabled" : ""}>Apex ${band.apex}M</button>
          </div>
          ${index === 0 ? `
          <div class="plaza-block">
            <div class="field">
              <label for="rallyCapacityInput">Rally Plaza capacity (troops)</label>
              <input class="input" id="rallyCapacityInput" type="number" min="0" step="1000" inputmode="numeric" placeholder="Example: 400000" value="${state.rallyCapacity || ""}">
            </div>
            <div class="plaza-live">
              ${rallyGateWaitingNoteHtml()}
              <div class="summary-line"><span>Plaza entered</span><b data-checklist="plaza">${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
              <div class="summary-line"><span>Rally role</span><b data-live-rally-role class="${role.pending ? "" : (role.assigned_role === "RL" ? "gap-met" : "gap-short")}">${role.pending ? "Waiting" : (role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner")}</b></div>
              <div class="summary-line"><span>Role gate</span><b data-live-rally-reason>${escapeHtml(formatRallyGateReasonForChecklist())}</b></div>
            </div>
          </div>` : ""}
          <div class="apc-footer">
            <div class="apc-stat"><span>Suggested cap</span><strong data-apc-stat="cap">${max}M</strong></div>
            <div class="apc-stat"><span>Status band</span><strong data-apc-stat="band">${getBandLabel(state.level, apc.cp)}</strong></div>
            <div class="apc-stat"><span>Gap to frontline</span><strong data-apc-stat="gap" class="${gap.met ? "gap-met" : "gap-short"}">${formatGap(gap)}</strong></div>
          </div>
          </div>
          ${optional && !apc4On ? `<p class="apc4-skip-note">APC 4 is off. Tick the box above to enter CP and faction, or continue to Review.</p>` : ""}
        </div>
      </div>`;
    enableTilt(el.wizardContent.querySelector("[data-tilt]"));
  }

  function renderReviewStep() {
    const band = BANDS[state.level];
    const total = getTotalFromState();
    const activeCount = getActiveApcCount(state.apcs);
    const average = total / activeCount;
    const mainStatus = STATUS[getStatusKey(state.level, state.apcs[0].cp)];
    const mainGap = getFrontlineGap(state.level, state.apcs[0].cp);
    const role = classifyCurrentState();
    el.wizardContent.innerHTML = `
      <div class="review-grid">
        <div class="review-card">
          <h4>Operator snapshot</h4>
          <div class="summary-stack">
            <div class="summary-line"><span>Player</span><b>${escapeHtml(state.name || "Unnamed")}</b></div>
            <div class="summary-line"><span>Watchtower</span><b>${formatLevel(state.level)}</b></div>
            <div class="summary-line"><span>PH-L rank</span><b>${state.rank}</b></div>
            <div class="summary-line"><span>Personal Code</span><b>${state.personalCode ? escapeHtml(state.personalCode) : "Generated on first submit — save the popup"}</b></div>
            <div class="summary-line"><span>Main frontline target</span><b>${band.frontline}M</b></div>
            <div class="summary-line"><span>Main gap</span><b>${formatGap(mainGap)}</b></div>
          </div>
          <div class="field plaza-review-field">
            <label for="rallyCapacityInput">Rally Plaza capacity (troops)</label>
            <input class="input" id="rallyCapacityInput" type="number" min="0" step="1000" inputmode="numeric" placeholder="Example: 400000" value="${state.rallyCapacity || ""}">
          </div>
        </div>
        <div class="review-card">
          <h4>APC CP + rally role</h4>
          <div class="summary-stack">
            ${state.apcs.map((apc, i) => {
              const gap = i === 0 ? getFrontlineGap(state.level, apc.cp) : null;
              const optional = i >= REQUIRED_APC_COUNT;
              if (optional && !state.hasApc4) {
                return `<div class="summary-line apc-review-line"><span>APC 4 · Optional</span><b class="apc-review-values"><em class="apc-cp">Off <small>skipped</small></em></b></div>`;
              }
              const cpLabel = Number(apc.cp) > 0
                ? `${formatNumber(apc.cp)}M <small>entered</small>`
                : (optional ? "Empty <small>optional</small>" : `${formatNumber(apc.cp)}M <small>entered</small>`);
              return `<div class="summary-line apc-review-line">
                <span>APC ${i + 1}${optional ? " · Optional" : ""} · ${apc.faction}</span>
                <b class="apc-review-values">
                  <em class="apc-cp">${cpLabel}</em>
                  ${gap ? `<em class="apc-gap ${gap.met ? "gap-met" : "gap-short"}">${formatGap(gap)} <small>vs frontline</small></em>` : ""}
                </b>
              </div>`;
            }).join("")}
            <div class="summary-line"><span>Total APC CP</span><b>${formatNumber(total)}M</b></div>
            <div class="summary-line"><span>Average APC</span><b>${formatNumber(average)}M <small>of ${activeCount}</small></b></div>
            <div class="summary-line"><span>Plaza</span><b data-live-plaza>${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
            <div class="summary-line"><span>Rally role</span><b data-live-rally-role class="${role.pending ? "" : (role.assigned_role === "RL" ? "gap-met" : "gap-short")}">${role.pending ? "Waiting" : (role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner")}</b></div>
            <div class="summary-line"><span>Status</span><b style="color:${mainStatus.color}">${mainStatus.label}</b></div>
          </div>
        </div>
      </div>`;
  }

  function onDynamicInput(event) {
    const target = event.target;

    if (target.id === "memberNameInput") {
      state.name = target.value;
      const checklist = el.wizardContent.querySelector('[data-checklist="name"]');
      if (checklist) checklist.textContent = state.name.trim() ? "Yes" : "No";
      syncLiveRallyClassification();
      return;
    }

    if (target.id === "memberLevelInput") {
      state.level = target.value;
      clampStateApcsToLevel();
      renderWizard(true);
      renderNonDestructive({ levelChanged: true });
      syncLiveRallyClassification();
      focusWizardStep();
      return;
    }

    if (target.id === "memberRankInput") {
      state.rank = target.value;
      const checklist = el.wizardContent.querySelector('[data-checklist="rank"]');
      if (checklist) checklist.textContent = state.rank;
      syncLiveRallyClassification();
      return;
    }

    if (target.id === "wizardHasApc4") {
      state.hasApc4 = Boolean(target.checked);
      if (!state.hasApc4) {
        state.apcs[REQUIRED_APC_COUNT].cp = 0;
      }
      renderWizard(true);
      syncLiveRallyClassification();
      playSfx("click");
      return;
    }

    if (target.id === "rallyCapacityInput") {
      state.rallyCapacity = Math.max(0, Math.floor(Number(target.value || 0)));
      const plaza = el.wizardContent.querySelector('[data-checklist="plaza"]');
      if (plaza) plaza.textContent = state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—";
      syncLiveRallyClassification();
      return;
    }

    if (target.id === "personalCodeInput") {
      state.personalCode = normalizePersonalCode(target.value);
      return;
    }

    if (!target.dataset.apcIndex) return;

    const idx = Number(target.dataset.apcIndex);

    if (target.classList.contains("cp-input")) {
      state.apcs[idx].cp = normalizeApcCp(target.value || 0);
      if (idx >= REQUIRED_APC_COUNT && state.apcs[idx].cp > 0) state.hasApc4 = true;
      const slider = document.getElementById(`slider${idx}`);
      if (slider) slider.value = String(Math.min(Number(slider.max || state.apcs[idx].cp), state.apcs[idx].cp));
    }

    if (target.classList.contains("slider")) {
      state.apcs[idx].cp = normalizeApcCp(target.value);
      if (idx >= REQUIRED_APC_COUNT && state.apcs[idx].cp > 0) state.hasApc4 = true;
      const input = document.getElementById(`cpInput${idx}`);
      if (input) input.value = target.value;
    }

    updateApcLiveStats(idx);
    syncLiveRallyClassification();
    if (isAdmin) renderSummaryStrip();
  }

  function onDynamicClick(event) {
    unlockAudio();

    const stepBtn = event.target.closest("[data-go-step]");
    if (stepBtn) {
      const targetStep = Number(stepBtn.dataset.goStep);
      if (Number.isNaN(targetStep) || targetStep === currentStep) return;
      if (targetStep > currentStep && !validateStep(0)) return;
      currentStep = targetStep;
      wizardRailDirty = true;
      renderWizard(true);
      renderNonDestructive();
      focusWizardStep();
      playSfx("transition");
      return;
    }

    const rankBtn = event.target.closest("[data-fill-rank]");
    if (rankBtn) {
      state.rank = rankBtn.dataset.fillRank;
      const rankSelect = document.getElementById("memberRankInput");
      if (rankSelect) setSelectValue(rankSelect, state.rank);
      const checklist = el.wizardContent.querySelector('[data-checklist="rank"]');
      if (checklist) checklist.textContent = state.rank;
      syncLiveRallyClassification();
      playSfx("click");
      return;
    }

    const factionBtn = event.target.closest("[data-faction]");
    if (factionBtn) {
      if (factionBtn.hasAttribute("data-drawer-faction")) {
        const idx = Number(factionBtn.dataset.drawerFaction);
        el.memberDrawerBody?.querySelectorAll(`[data-drawer-faction="${idx}"]`).forEach(node => {
          node.classList.toggle("active", node.dataset.faction === factionBtn.dataset.faction);
        });
        playSfx("click");
        void saveMemberDrawer();
        return;
      }
      const idx = Number(factionBtn.dataset.apcIndex);
      state.apcs[idx].faction = factionBtn.dataset.faction;
      el.wizardContent.querySelectorAll(`[data-faction][data-apc-index="${idx}"]`).forEach(node => {
        node.classList.toggle("active", node.dataset.faction === state.apcs[idx].faction);
      });
      const factionStat = el.wizardContent.querySelector('[data-apc-stat="faction"]');
      if (factionStat) factionStat.textContent = state.apcs[idx].faction;
      syncLiveRallyClassification();
      playSfx("click");
      return;
    }

    const stepChange = event.target.closest("[data-step]");
    if (stepChange) {
      applyApcDelta(Number(stepChange.dataset.apcIndex), Number(stepChange.dataset.step));
      return;
    }

    const preset = event.target.closest("[data-preset]");
    if (preset) {
      applyApcValue(Number(preset.dataset.apcIndex), Number(preset.dataset.preset));
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action?.dataset.action === "edit-event") {
      beginEditScheduledEvent(action.dataset.id);
      return;
    }
    if (action?.dataset.action === "delete-event") {
      void deleteScheduledEvent(action.dataset.id);
      return;
    }
    if (action?.dataset.action === "rsvp-event") {
      void rsvpScheduledEvent(action.dataset.id, action.dataset.status);
      return;
    }
    const fieldTap = event.target.closest("[data-edit-field]");
    if (fieldTap?.dataset.id && fieldTap.dataset.editField) {
      openMemberDrawer(fieldTap.dataset.id, fieldTap.dataset.editField);
      return;
    }
    if (action?.dataset.action === "toggle-apc4" && action.dataset.id) {
      event.preventDefault();
      void toggleMemberApc4(action.dataset.id, action.dataset.enabled === "1");
      return;
    }
    if (action?.dataset.action === "delete") {
      deleteMember(action.dataset.id);
      return;
    }
    if (action?.dataset.action === "copy-code") {
      const code = action.dataset.code || "";
      if (code) {
        navigator.clipboard?.writeText(code).then(() => {
          toast("Personal Code copied.", "success");
        }).catch(() => toast(`Code: <strong>${escapeHtml(code)}</strong>`, "success"));
      }
      playSfx("click");
      return;
    }
    if (action?.dataset.action === "generate-code") {
      const regenerate = action.dataset.regenerate === "1";
      if (regenerate && !window.confirm("Generate a new Personal Code? The old one will stop working for this member.")) {
        return;
      }
      assignOrRegeneratePersonalCode(action.dataset.id, { regenerate });
      playSfx("click");
      return;
    }
    if (action?.dataset.action === "reveal-code") {
      const code = action.dataset.code || "";
      if (code) {
        pendingPersonalCodeReveal = code;
        openPersonalCodeModal(code);
      }
      playSfx("click");
      return;
    }
    if (action?.dataset.action === "clear-review") {
      clearNeedsReviewFlag(action.dataset.id);
      return;
    }

    const emptyAction = event.target.closest("[data-empty-action]");
    if (emptyAction?.dataset.emptyAction === "start") {
      currentStep = 0;
      wizardRailDirty = true;
      if (window.matchMedia(MOBILE_MQ).matches) setMobileTab("push", { silent: true });
      document.getElementById("operatorConsole")?.scrollIntoView({ behavior: "smooth", block: "start" });
      renderWizard(true);
      renderNonDestructive();
      playSfx("transition");
      return;
    }
  }

  function applyApcDelta(index, delta) {
    if (index >= REQUIRED_APC_COUNT && !state.hasApc4) return;
    state.apcs[index].cp = normalizeApcCp(state.apcs[index].cp + delta);
    if (index >= REQUIRED_APC_COUNT && state.apcs[index].cp > 0) state.hasApc4 = true;
    syncApcControls(index);
    updateApcLiveStats(index);
    syncLiveRallyClassification();
    if (isAdmin) renderSummaryStrip();
    playSfx("click");
  }

  function applyApcValue(index, value) {
    if (index >= REQUIRED_APC_COUNT && !state.hasApc4 && Number(value) > 0) state.hasApc4 = true;
    if (index >= REQUIRED_APC_COUNT && !state.hasApc4) return;
    state.apcs[index].cp = normalizeApcCp(value);
    syncApcControls(index);
    updateApcLiveStats(index);
    syncLiveRallyClassification();
    if (isAdmin) renderSummaryStrip();
    playSfx("click");
  }

  function syncApcControls(index) {
    const value = String(state.apcs[index].cp);
    const input = document.getElementById(`cpInput${index}`);
    const slider = document.getElementById(`slider${index}`);
    if (input) input.value = value;
    if (slider) slider.value = value;
  }

  function updateApcLiveStats(index) {
    const apc = state.apcs[index];
    const gap = getFrontlineGap(state.level, apc.cp);
    const bandStat = el.wizardContent.querySelector('[data-apc-stat="band"]');
    const factionStat = el.wizardContent.querySelector('[data-apc-stat="faction"]');
    const gapStat = el.wizardContent.querySelector('[data-apc-stat="gap"]');
    if (bandStat) bandStat.textContent = getBandLabel(state.level, apc.cp);
    if (factionStat) factionStat.textContent = apc.faction;
    if (gapStat) {
      gapStat.textContent = formatGap(gap);
      gapStat.classList.toggle("gap-met", gap.met);
      gapStat.classList.toggle("gap-short", !gap.met);
    }
    el.orbitValues[index].textContent = `${formatNumber(apc.cp)}M`;
    el.orbitFactions[index].textContent = apc.faction;
  }

  function renderNonDestructive(options = {}) {
    renderScan();
    updateWizardMeta();
    syncLiveRallyClassification({ skipScan: true });
    if (isAdmin) {
      renderSummaryStrip();
      if (options.levelChanged) renderRefList(true);
    }
  }

  function nextStep() {
    if (!validateStep(currentStep)) return;
    if (currentStep < stepMeta.length - 1) {
      currentStep += 1;
      wizardRailDirty = true;
      renderWizard(true);
      renderNonDestructive();
      focusWizardStep();
      playSfx("transition");
      return;
    }
    saveCurrentMember();
  }

  function prevStep() {
    if (currentStep === 0) return;
    currentStep -= 1;
    wizardRailDirty = true;
    renderWizard(true);
    renderNonDestructive();
    focusWizardStep();
    playSfx("click");
  }

  function focusWizardStep() {
    const focusTarget = el.wizardContent.querySelector(
      "#memberNameInput, .ui-select-trigger, .cp-input, .seg-btn.active, .seg-btn"
    );
    if (!focusTarget) return;
    window.requestAnimationFrame(() => {
      focusTarget.focus({ preventScroll: true });
    });
  }

  function clampStateApcsToLevel() {
    // HQ level no longer caps stored APC CP — keep values as entered.
  }

  function validateStep(stepIndex) {
    if (stepIndex === 0 && !state.name.trim()) {
      toast("Please enter a player name first.", "error");
      playSfx("error");
      if (currentStep !== 0) {
        currentStep = 0;
        wizardRailDirty = true;
        renderWizard(true);
        renderNonDestructive();
      }
      window.requestAnimationFrame(() => {
        document.getElementById("memberNameInput")?.focus();
      });
      return false;
    }

    const meta = stepMeta[stepIndex];
    if (meta?.key?.startsWith("apc")) {
      const idx = Number(meta.key.slice(3)) - 1;
      if (idx >= 0 && idx < REQUIRED_APC_COUNT && !(Number(state.apcs[idx]?.cp) > 0)) {
        toast(`Enter APC ${idx + 1} CP before continuing.`, "error");
        playSfx("error");
        window.requestAnimationFrame(() => {
          document.getElementById(`cpInput${idx}`)?.focus();
        });
        return false;
      }
    }
    return true;
  }

  function findMemberByName(name, excludeId = null) {
    const normalized = name.trim().toLowerCase();
    return roster.find(member => member.name.trim().toLowerCase() === normalized && member.id !== excludeId);
  }

  function findMemberByPersonalCode(code) {
    const normalized = normalizePersonalCode(code);
    if (!normalized) return null;
    return roster.find(member => normalizePersonalCode(member.personalCode) === normalized && !member.isDemo) || null;
  }

  function normalizePersonalCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 16);
  }

  function generatePersonalCode() {
    let code = "PHL-";
    for (let i = 0; i < 6; i += 1) {
      code += PERSONAL_CODE_CHARS[Math.floor(Math.random() * PERSONAL_CODE_CHARS.length)];
    }
    if (findMemberByPersonalCode(code)) return generatePersonalCode();
    return code;
  }

  async function assignOrRegeneratePersonalCode(id, { regenerate = false } = {}) {
    if (!isAdmin) {
      openAdminModal();
      toast("Admin access required to assign Personal Codes.", "error");
      return null;
    }
    const member = roster.find(m => m.id === id);
    if (!member) return null;
    if (member.personalCode && !regenerate) {
      pendingPersonalCodeReveal = member.personalCode;
      openPersonalCodeModal(member.personalCode);
      return member.personalCode;
    }
    const previous = {
      ...member,
      apcs: (member.apcs || []).map(apc => ({ ...apc }))
    };
    const code = generatePersonalCode();
    member.personalCode = code;
    member.updated = Date.now();
    saveRoster();
    appendHistoryEvent({
      action: regenerate ? "code-regenerate" : "code-assign",
      memberId: member.id,
      memberName: member.name,
      actor: adminSession?.name || "admin",
      fields: diffMemberFields(previous, member),
      note: regenerate ? "Personal Code regenerated by admin" : "Personal Code assigned by admin"
    });
    queueCloudOutbox(member);
    rememberPersonalCode(member.name, code);
    pendingPersonalCodeReveal = code;
    openPersonalCodeModal(code);
    if (drawerMemberId === member.id && drawerField === "personalCode") {
      renderMemberDrawer();
    }
    renderAll();
    const ok = await pushCloudRosterWithRetry({ silent: true });
    toast(
      ok
        ? `Personal Code ${regenerate ? "regenerated" : "assigned"} for <strong>${escapeHtml(member.name)}</strong>.`
        : `Code saved locally for <strong>${escapeHtml(member.name)}</strong>. Cloud sync will retry.`,
      ok ? "success" : "error"
    );
    playSfx(ok ? "success" : "error");
    return code;
  }

  function makeUpdateReviewName(baseName) {
    const clean = String(baseName || "member")
      .trim()
      .replace(/\[|\]/g, "")
      .replace(/-updt\d*$/i, "")
      .replace(/\s+/g, "")
      .slice(0, 24);
    return `${clean || "member"}-updt`.slice(0, 30);
  }

  function memberNeedsReview(member) {
    if (!member) return false;
    if (member.needsReview) return true;
    return /\]-updt$/i.test(member.name || "") || /-updt$/i.test(member.name || "");
  }

  async function saveCurrentMember() {
    // Flush visible identity selects in case UI and state drifted.
    const levelEl = document.getElementById("memberLevelInput");
    const rankEl = document.getElementById("memberRankInput");
    const codeEl = document.getElementById("personalCodeInput");
    if (levelEl?.value && BANDS[levelEl.value]) state.level = levelEl.value;
    if (rankEl?.value && RANKS.includes(rankEl.value)) state.rank = rankEl.value;
    if (codeEl) state.personalCode = normalizePersonalCode(codeEl.value);

    if (!state.name.trim()) {
      toast("Please enter a player name first.", "error");
      playSfx("error");
      return;
    }
    for (let i = 0; i < REQUIRED_APC_COUNT; i += 1) {
      if (!(Number(state.apcs[i]?.cp) > 0)) {
        toast(`APC ${i + 1} is required. APC 4 is optional.`, "error");
        playSfx("error");
        currentStep = i + 1;
        wizardRailDirty = true;
        renderWizard(true);
        renderNonDestructive();
        window.requestAnimationFrame(() => {
          document.getElementById(`cpInput${i}`)?.focus();
        });
        return;
      }
    }
    if (!Number(state.rallyCapacity) && !window.confirm(
      "Rally Plaza capacity is empty. Save anyway? Plaza is still used for strike-team march packing."
    )) {
      document.getElementById("rallyCapacityInput")?.focus();
      return;
    }

    const enteredCode = normalizePersonalCode(state.personalCode);
    let codeMatch = enteredCode ? findMemberByPersonalCode(enteredCode) : null;
    if (enteredCode && !codeMatch && !editingId && !isAdmin) {
      try {
        codeMatch = await fetchMemberByPersonalCode(enteredCode);
        if (codeMatch) {
          const idx = roster.findIndex(m => m.id === codeMatch.id);
          if (idx >= 0) roster[idx] = codeMatch;
          else roster = isMember ? [codeMatch] : [codeMatch, ...roster.filter(m => m.id !== codeMatch.id)].slice(0, 1);
        }
      } catch {
        toast("Could not verify Personal Code with the cloud roster.", "error");
        playSfx("error");
        return;
      }
    }
    if (enteredCode && !codeMatch && !editingId) {
      toast("Personal Code not found. Check the code or leave it blank to create a review entry.", "error");
      playSfx("error");
      return;
    }

    const baseName = state.name.trim();
    let targetId = editingId;
    let personalCode = enteredCode || null;
    let needsReview = false;
    let displayName = baseName;
    let actionLabel = "create";
    let previous = null;
    let revealCode = false;

    if (isAdmin && editingId) {
      previous = roster.find(m => m.id === editingId) || null;
      targetId = editingId;
      personalCode = previous?.personalCode || generatePersonalCode();
      needsReview = false;
      displayName = baseName;
      actionLabel = "admin-update";
    } else if (codeMatch) {
      previous = codeMatch;
      targetId = codeMatch.id;
      personalCode = codeMatch.personalCode || enteredCode;
      needsReview = false;
      displayName = baseName;
      actionLabel = "code-overwrite";
    } else if (editingId && isAdmin) {
      previous = roster.find(m => m.id === editingId) || null;
      targetId = editingId;
      personalCode = previous?.personalCode || generatePersonalCode();
      actionLabel = "admin-update";
    } else {
      // No personal code: first-time register OR create -updt review copy
      const existingSameName = findMemberByName(baseName);
      if (existingSameName && existingSameName.personalCode) {
        displayName = makeUpdateReviewName(baseName);
        needsReview = true;
        targetId = cryptoId();
        personalCode = generatePersonalCode();
        actionLabel = "needs-review";
        previous = null;
      } else if (existingSameName && !existingSameName.personalCode) {
        // Legacy entry without code — claim it and assign a code
        previous = existingSameName;
        targetId = existingSameName.id;
        personalCode = generatePersonalCode();
        needsReview = false;
        displayName = baseName;
        actionLabel = "claim-legacy";
        revealCode = true;
      } else {
        targetId = cryptoId();
        personalCode = generatePersonalCode();
        needsReview = false;
        displayName = baseName;
        actionLabel = "create";
        revealCode = true;
      }
    }

    let member = {
      id: targetId || cryptoId(),
      name: displayName,
      level: state.level,
      rank: state.rank,
      rallyCapacity: Math.max(0, Math.floor(Number(state.rallyCapacity || 0))),
      updated: Date.now(),
      personalCode,
      needsReview,
      hasApc4: Boolean(state.hasApc4),
      apcs: state.apcs.map((apc, i) => ({
        cp: i >= REQUIRED_APC_COUNT && !state.hasApc4 ? 0 : normalizeApcCp(apc.cp),
        faction: FACTIONS.includes(apc.faction) ? apc.faction : "Fighter"
      }))
    };

    const fields = diffMemberFields(previous, member);
    const idx = roster.findIndex(item => item.id === member.id);
    if (idx >= 0) roster[idx] = member;
    else roster.unshift(member);

    saveRoster();
    prefs.lastLevel = member.level;
    prefs.lastRank = member.rank;
    savePrefs();
    rememberPersonalCode(member.name, member.personalCode);
    appendHistoryEvent({
      action: actionLabel,
      memberId: member.id,
      memberName: member.name,
      actor: isAdmin ? (adminSession?.name || "admin") : "member",
      fields,
      note: needsReview ? "Submitted without Personal Code" : (revealCode ? "Personal Code assigned" : "")
    });
    queueCloudOutbox(member);
    // Do NOT unlock member session before cloud push — a brand-new Personal Code is not
    // valid auth yet and would 404. Unlock after a successful create/claim sync instead.
    const shouldUnlockAfterSync =
      !isAdmin &&
      Boolean(member.personalCode) &&
      (actionLabel === "code-overwrite" || actionLabel === "create" || actionLabel === "claim-legacy");
    renderAll();
    setSavingUi(true);

    try {
      // Leadership refreshes full roster first; members/public only push scoped submit
      if (isAdmin) {
        await pullCloudRoster({ silent: true });
        member = upsertMember(member);
        saveRoster();
        queueCloudOutbox(member);
      }
      const synced = await pushCloudRosterWithRetry({ silent: true });
      if (synced) {
        clearCloudOutboxMember(member.id);
        // Prefer cloud-accepted row (authoritative Personal Code)
        const accepted =
          roster.find(m => m.id === member.id) ||
          roster.find(m => normalizePersonalCode(m.personalCode) === normalizePersonalCode(member.personalCode)) ||
          member;
        member = accepted;
        if (shouldUnlockAfterSync && member.personalCode) {
          memberSession = {
            personalCode: normalizePersonalCode(member.personalCode),
            memberId: member.id,
            name: member.name,
            rank: member.rank,
            roleTier: "R1-R3"
          };
          isMember = true;
          sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(memberSession));
          rememberPersonalCode(member.name, member.personalCode);
          roster = [member];
          applyAccessMode();
          await pullMemberSelf({ silent: true });
          const refreshed = roster[0];
          if (refreshed) member = refreshed;
        }
        if (revealCode || actionLabel === "claim-legacy" || actionLabel === "needs-review") {
          pendingPersonalCodeReveal = member.personalCode;
          openPersonalCodeModal(member.personalCode);
        }
        const reviewNote = needsReview ? " Flagged for admin review." : "";
        const codeNote =
          revealCode && member.personalCode
            ? ` Your Personal Code is <strong>${escapeHtml(member.personalCode)}</strong> — save it.`
            : "";
        toast(
          actionLabel === "code-overwrite" || actionLabel === "admin-update" || actionLabel === "claim-legacy"
            ? `<strong>${escapeHtml(member.name)}</strong> updated in the shared cloud roster.${reviewNote}${codeNote}`
            : `<strong>${escapeHtml(member.name)}</strong> saved to the shared cloud roster.${reviewNote}${codeNote}`,
          "success"
        );
        playSfx("success");
      } else {
        if (revealCode || actionLabel === "claim-legacy" || actionLabel === "needs-review") {
          pendingPersonalCodeReveal = member.personalCode;
          openPersonalCodeModal(member.personalCode);
        }
        toast(
          `<strong>${escapeHtml(member.name)}</strong> kept on this device. Cloud sync failed — will retry automatically.`,
          "error"
        );
        playSfx("error");
      }
    } finally {
      setSavingUi(false);
    }
    resetForm(false);
  }

  function upsertMember(member) {
    const idx = roster.findIndex(item => item.id === member.id);
    if (idx >= 0) {
      roster[idx] = member;
      return member;
    }
    const byName = roster.findIndex(item => item.name.trim().toLowerCase() === member.name.trim().toLowerCase() && !item.isDemo);
    if (byName >= 0) {
      const merged = { ...member, id: roster[byName].id };
      roster[byName] = merged;
      return merged;
    }
    roster.unshift(member);
    return member;
  }

  function setSavingUi(busy) {
    if (!el.primaryBtn) return;
    el.primaryBtn.disabled = busy;
    el.primaryBtn.setAttribute("aria-busy", String(busy));
    if (busy) el.primaryBtn.dataset.label = el.primaryBtn.textContent;
    if (busy) el.primaryBtn.textContent = "Saving to cloud…";
    else if (el.primaryBtn.dataset.label) el.primaryBtn.textContent = el.primaryBtn.dataset.label;
  }

  function resetForm(play = true) {
    editingId = null;
    currentStep = 0;
    state.name = "";
    state.level = prefs.lastLevel && BANDS[prefs.lastLevel] ? prefs.lastLevel : "WT30";
    state.rank = RANKS.includes(prefs.lastRank) ? prefs.lastRank : "R1";
    state.rallyCapacity = 0;
    state.personalCode = "";
    state.hasApc4 = false;
    state.apcs = Array.from({ length: APC_COUNT }, () => ({ cp: 0, faction: "Fighter" }));
    renderAll();
    if (play) playSfx("click");
  }

  function fieldLabel(field) {
    if (!field) return "Member";
    if (field === "name") return "Player name";
    if (field === "level") return "Level";
    if (field === "rank") return "PH-L rank";
    if (field === "plaza") return "Rally Plaza capacity";
    if (field === "personalCode") return "Personal Code";
    if (field === "needsReview") return "Needs review";
    if (field === "hasApc4") return "4th APC";
    const apcMatch = /^apc(\d)\.(cp|faction)$/.exec(field);
    if (apcMatch) {
      const n = Number(apcMatch[1]) + 1;
      const optional = n > REQUIRED_APC_COUNT ? " (optional)" : "";
      return apcMatch[2] === "cp" ? `APC ${n} CP${optional}` : `APC ${n} faction${optional}`;
    }
    return field;
  }

  function memberHasApc4(member) {
    if (!member) return false;
    if (typeof member.hasApc4 === "boolean") return member.hasApc4;
    return Number(member.apcs?.[REQUIRED_APC_COUNT]?.cp || 0) > 0;
  }

  async function toggleMemberApc4(id, enabled) {
    const previous = roster.find(m => m.id === id);
    if (!previous) return;
    const canEdit =
      isAdmin ||
      (isMember &&
        memberSession &&
        (previous.id === memberSession.memberId ||
          normalizePersonalCode(previous.personalCode) === normalizePersonalCode(memberSession.personalCode)));
    if (!canEdit) {
      if (!isAdmin && !isMember) openMemberModal();
      else if (!isAdmin) openAdminModal();
      return;
    }
    if (Boolean(memberHasApc4(previous)) === Boolean(enabled)) return;

    const member = {
      ...previous,
      apcs: previous.apcs.map(apc => ({ ...apc })),
      hasApc4: Boolean(enabled),
      updated: Date.now()
    };
    const fields = diffMemberFields(previous, member);
    const idx = roster.findIndex(m => m.id === member.id);
    if (idx >= 0) roster[idx] = member;
    saveRoster();
    appendHistoryEvent({
      action: "field-edit",
      memberId: member.id,
      memberName: member.name,
      actor: isAdmin ? (adminSession?.name || "admin") : "member",
      fields,
      note: enabled ? "Enabled 4th APC" : "Disabled 4th APC"
    });
    queueCloudOutbox(member);
    renderAll();
    const ok = await pushCloudRosterWithRetry({ silent: true });
    toast(
      ok
        ? `4th APC ${enabled ? "enabled" : "turned off"} for <strong>${escapeHtml(member.name)}</strong>.`
        : `<strong>${escapeHtml(member.name)}</strong> saved locally. Cloud sync will retry.`,
      ok ? "success" : "error"
    );
    playSfx(ok ? "success" : "error");
  }

  function normalizeApcCp(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return clamp(n, 0, APC_CP_STORE_MAX);
  }

  function openMemberDrawer(id, field) {
    if (!field) return;
    const member = roster.find(item => item.id === id);
    if (!member || !el.memberDrawer || !el.memberDrawerBody) return;

    const canEdit =
      isAdmin ||
      (isMember &&
        memberSession &&
        (member.id === memberSession.memberId ||
          normalizePersonalCode(member.personalCode) === normalizePersonalCode(memberSession.personalCode)));

    if (!canEdit) {
      if (!isAdmin && !isMember) openMemberModal();
      else if (!isAdmin) openAdminModal();
      return;
    }

    drawerMemberId = member.id;
    drawerField = field;
    lastFocusedElement = document.activeElement;
    renderMemberDrawer();
    el.memberDrawer.classList.add("open");
    el.memberDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    playSfx("transition");
  }

  function renderMemberDrawer() {
    const member = roster.find(item => item.id === drawerMemberId);
    if (!member || !el.memberDrawerBody || !drawerField) return;

    const eyebrow = el.memberDrawerEyebrow;
    if (eyebrow) eyebrow.innerHTML = "<span></span>Edit field";
    if (el.memberDrawerTitle) el.memberDrawerTitle.textContent = fieldLabel(drawerField);
    if (el.memberDrawerSub) {
      const levelLabel = formatLevel(member.level);
      if (drawerField === "hasApc4") {
        el.memberDrawerSub.textContent = `${member.name} · turn 4th APC on or off`;
      } else if (drawerField?.endsWith?.(".cp")) {
        el.memberDrawerSub.textContent = `${member.name} · Level ${levelLabel}`;
      } else if (drawerField === "level") {
        el.memberDrawerSub.textContent = `${member.name} · HQ level (does not cap APC CP)`;
      } else {
        el.memberDrawerSub.textContent = `${member.name} · Level ${levelLabel}`;
      }
    }

    let body = "";
    if (drawerField === "name") {
      body = `<div class="field"><label for="drawerFieldInput">Player name</label><input class="input" id="drawerFieldInput" maxlength="30" value="${escapeHtml(member.name)}"></div>`;
    } else if (drawerField === "level") {
      body = `<div class="field"><label for="drawerFieldInput">Level</label><select id="drawerFieldInput">${levelOptionsHtml(member.level)}</select><small>HQ level is for benchmarks only — it does not limit the APC CP you save.</small></div>`;
    } else if (drawerField === "rank") {
      body = `<div class="field"><label for="drawerFieldInput">PH-L rank</label><select id="drawerFieldInput">${rankOptionsHtml(member.rank)}</select></div>`;
    } else if (drawerField === "plaza") {
      body = `<div class="field"><label for="drawerFieldInput">Rally Plaza capacity</label><input class="input" id="drawerFieldInput" type="number" min="0" step="1000" value="${member.rallyCapacity || 0}"></div>`;
    } else if (drawerField === "personalCode") {
      body = `<div class="field personal-code-field"><label for="drawerFieldInput">Personal Code</label><input class="input" id="drawerFieldInput" maxlength="16" value="${escapeHtml(member.personalCode || "")}"><small>Leave blank to keep current / auto-assign on save.</small>
        <div class="drawer-code-actions">
          ${member.personalCode ? `<button class="btn btn-ghost" type="button" data-action="copy-code" data-code="${escapeHtml(member.personalCode)}">Copy code</button>` : ""}
          ${isAdmin ? `<button class="btn btn-ghost" type="button" data-action="generate-code" data-id="${member.id}" ${member.personalCode ? 'data-regenerate="1"' : ""}>${member.personalCode ? "Regenerate" : "Generate code"}</button>` : ""}
        </div>
      </div>`;
    } else if (drawerField === "needsReview") {
      body = `<label class="field drawer-check-row"><input type="checkbox" id="drawerFieldInput" ${memberNeedsReview(member) ? "checked" : ""}><span>Flag for admin review (-updt)</span></label>`;
    } else if (drawerField === "hasApc4") {
      body = `<label class="field drawer-check-row" for="drawerFieldInput">
          <input type="checkbox" id="drawerFieldInput" ${memberHasApc4(member) ? "checked" : ""}>
          <span>This member has a 4th APC</span>
        </label>
        <small>Turn off if they only run 3 APCs. Totals and RL/RJ ignore APC 4 while it is off.</small>`;
    } else {
      const apcMatch = /^apc(\d)\.(cp|faction)$/.exec(drawerField);
      if (apcMatch) {
        const i = Number(apcMatch[1]);
        const apc = member.apcs?.[i] || { cp: 0, faction: "Fighter" };
        if (i >= REQUIRED_APC_COUNT && !memberHasApc4(member)) {
          body = `<label class="field drawer-check-row"><input type="checkbox" id="drawerFieldInput" data-enable-apc4="1"><span>Enable 4th APC to edit this slot</span></label>
            <small>APC 4 is currently off for ${escapeHtml(member.name)}.</small>`;
        } else if (apcMatch[2] === "cp") {
          body = `<div class="field"><label for="drawerFieldInput">APC ${i + 1} CP (M)</label><input class="input" id="drawerFieldInput" type="number" min="0" max="${APC_CP_STORE_MAX}" step="any" value="${Number(apc.cp || 0)}"><small>Enter the real CP in millions. Saves exactly what you type.</small></div>`;
        } else {
          body = `<div class="field"><span class="field-label">APC ${i + 1} faction</span><div class="faction-row compact" id="drawerFactionRow">
            ${FACTIONS.map(f => `<button class="seg-btn ${apc.faction === f ? "active" : ""}" type="button" data-drawer-faction="${i}" data-faction="${f}">${f}</button>`).join("")}
          </div></div>`;
        }
      }
    }

    el.memberDrawerBody.innerHTML = body || `<p class="empty">Unknown field.</p>`;
    el.memberDrawerBody.scrollTop = 0;
    enhanceSelects(el.memberDrawerBody);
    bindMemberFieldAutoSave();
    const focusEl = document.getElementById("drawerFieldInput") || el.memberDrawerBody.querySelector(".seg-btn.active");
    focusEl?.focus?.();
  }

  function bindMemberFieldAutoSave() {
    const input = document.getElementById("drawerFieldInput");
    if (!input) return;
    if (input.type === "checkbox") {
      input.addEventListener("change", () => { void saveMemberDrawer(); });
      return;
    }
    if (input.tagName === "SELECT") {
      input.addEventListener("change", () => { void saveMemberDrawer(); });
      return;
    }
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveMemberDrawer();
      }
    });
  }

  function closeMemberDrawer() {
    if (!el.memberDrawer) return;
    el.memberDrawer.classList.remove("open");
    el.memberDrawer.setAttribute("aria-hidden", "true");
    drawerMemberId = null;
    drawerField = null;
    drawerSaving = false;
    if (!el.authModal?.classList.contains("open") && !el.deleteModal?.classList.contains("open") && !el.syncModal?.classList.contains("open") && !el.personalCodeModal?.classList.contains("open")) {
      document.body.classList.remove("modal-open");
    }
    if (lastFocusedElement?.focus) lastFocusedElement.focus();
  }

  async function saveMemberDrawer() {
    if (drawerSaving) return;
    const canEdit =
      isAdmin ||
      (isMember &&
        memberSession &&
        drawerMemberId &&
        (drawerMemberId === memberSession.memberId ||
          roster.some(
            m =>
              m.id === drawerMemberId &&
              normalizePersonalCode(m.personalCode) === normalizePersonalCode(memberSession.personalCode)
          )));
    if (!canEdit || !drawerMemberId || !drawerField) return;
    const previous = roster.find(m => m.id === drawerMemberId);
    if (!previous) {
      closeMemberDrawer();
      return;
    }

    const member = {
      ...previous,
      apcs: previous.apcs.map(apc => ({ ...apc })),
      updated: Date.now()
    };
    let clampNote = "";
    let levelMaxNote = "";
    let savedCp = null;

    if (drawerField === "name") {
      const name = String(document.getElementById("drawerFieldInput")?.value || "").trim().slice(0, 30);
      if (!name) {
        toast("Name is required.", "error");
        playSfx("error");
        return;
      }
      member.name = name;
    } else if (drawerField === "level") {
      const level = document.getElementById("drawerFieldInput")?.value;
      if (!BANDS[level]) {
        toast("Invalid level.", "error");
        playSfx("error");
        return;
      }
      member.level = level;
    } else if (drawerField === "rank") {
      const rank = document.getElementById("drawerFieldInput")?.value;
      if (!RANKS.includes(rank)) {
        toast("Invalid rank.", "error");
        playSfx("error");
        return;
      }
      member.rank = rank;
    } else if (drawerField === "plaza") {
      member.rallyCapacity = Math.max(0, Math.floor(Number(document.getElementById("drawerFieldInput")?.value || 0)));
    } else if (drawerField === "personalCode") {
      let code = normalizePersonalCode(document.getElementById("drawerFieldInput")?.value || "");
      if (!code) code = previous.personalCode || generatePersonalCode();
      const codeOwner = findMemberByPersonalCode(code);
      if (codeOwner && codeOwner.id !== previous.id) {
        toast("That Personal Code belongs to another member.", "error");
        playSfx("error");
        return;
      }
      member.personalCode = code;
    } else if (drawerField === "needsReview") {
      member.needsReview = Boolean(document.getElementById("drawerFieldInput")?.checked);
    } else if (drawerField === "hasApc4") {
      member.hasApc4 = Boolean(document.getElementById("drawerFieldInput")?.checked);
      if (!member.hasApc4 && member.apcs[REQUIRED_APC_COUNT]) {
        // Keep stored CP/faction so turning it back on restores values; totals ignore while off.
      }
    } else {
      const apcMatch = /^apc(\d)\.(cp|faction)$/.exec(drawerField);
      if (!apcMatch) {
        toast("Unknown field.", "error");
        return;
      }
      const i = Number(apcMatch[1]);
      if (!member.apcs[i]) member.apcs[i] = { cp: 0, faction: "Fighter" };
      const enableApc4 = document.getElementById("drawerFieldInput")?.hasAttribute("data-enable-apc4");
      if (enableApc4) {
        member.hasApc4 = Boolean(document.getElementById("drawerFieldInput")?.checked);
        if (!member.hasApc4) {
          // leave as off
        }
      } else if (i >= REQUIRED_APC_COUNT) {
        member.hasApc4 = true;
        if (apcMatch[2] === "cp") {
          const cp = normalizeApcCp(document.getElementById("drawerFieldInput")?.value || 0);
          member.apcs[i] = { ...member.apcs[i], cp };
          savedCp = cp;
        } else {
          const factionBtn = el.memberDrawerBody.querySelector(`[data-drawer-faction="${i}"].active`);
          const faction = factionBtn?.dataset.faction || member.apcs[i].faction;
          if (!FACTIONS.includes(faction)) {
            toast("Pick a faction.", "error");
            playSfx("error");
            return;
          }
          member.apcs[i] = { ...member.apcs[i], faction };
        }
      } else if (apcMatch[2] === "cp") {
        const cp = normalizeApcCp(document.getElementById("drawerFieldInput")?.value || 0);
        member.apcs[i] = { ...member.apcs[i], cp };
        savedCp = cp;
      } else {
        const factionBtn = el.memberDrawerBody.querySelector(`[data-drawer-faction="${i}"].active`);
        const faction = factionBtn?.dataset.faction || member.apcs[i].faction;
        if (!FACTIONS.includes(faction)) {
          toast("Pick a faction.", "error");
          playSfx("error");
          return;
        }
        member.apcs[i] = { ...member.apcs[i], faction };
      }
    }

    const fields = diffMemberFields(previous, member);
    const editedLabel = fieldLabel(drawerField);
    const editedFieldKey = drawerField;
    const enablingApc4 =
      Boolean(document.getElementById("drawerFieldInput")?.hasAttribute("data-enable-apc4")) &&
      member.hasApc4;
    if (!fields.length) {
      closeMemberDrawer();
      return;
    }

    drawerSaving = true;
    const idx = roster.findIndex(m => m.id === member.id);
    if (idx >= 0) roster[idx] = member;
    saveRoster();
    appendHistoryEvent({
      action: "field-edit",
      memberId: member.id,
      memberName: member.name,
      actor: isAdmin ? (adminSession?.name || "admin") : "member",
      fields,
      note: `Edited ${editedLabel}`
    });
    queueCloudOutbox(member);

    if (isMember && memberSession) {
      memberSession = {
        ...memberSession,
        memberId: member.id,
        name: member.name,
        rank: member.rank,
        personalCode: normalizePersonalCode(member.personalCode || memberSession.personalCode)
      };
      sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(memberSession));
    }

    closeMemberDrawer();
    renderAll();
    const ok = await pushCloudRosterWithRetry({ silent: true });
    drawerSaving = false;
    if (enablingApc4 && ok) {
      openMemberDrawer(member.id, /^apc3\./.test(editedFieldKey || "") ? editedFieldKey : "apc3.cp");
    }
    const valueNote = savedCp != null ? ` → <strong>${formatNumber(savedCp)}M</strong>` : "";
    const apc4Note = editedFieldKey === "hasApc4"
      ? (member.hasApc4 ? " Enabled." : " Turned off.")
      : "";
    toast(
      ok
        ? `<strong>${escapeHtml(editedLabel)}</strong> updated for ${escapeHtml(member.name)}${valueNote}.${apc4Note}`
        : `<strong>${escapeHtml(member.name)}</strong> saved locally. Cloud sync will retry.`,
      ok ? "success" : "error"
    );
    playSfx(ok ? "success" : "error");
  }

  async function clearNeedsReviewFlag(id) {
    if (!isAdmin) {
      openAdminModal();
      return;
    }
    const member = roster.find(m => m.id === id);
    if (!member) return;
    const previous = { ...member };
    let cleanName = member.name.replace(/^\[(.+?)\]-updt$/i, "$1").replace(/-updt$/i, "");
    cleanName = cleanName.trim().slice(0, 30) || member.name;
    member.name = cleanName;
    member.needsReview = false;
    member.updated = Date.now();
    if (!member.personalCode) member.personalCode = generatePersonalCode();
    saveRoster();
    appendHistoryEvent({
      action: "clear-review",
      memberId: member.id,
      memberName: member.name,
      actor: adminSession?.name || "admin",
      fields: diffMemberFields(previous, member),
      note: "Cleared needs-review flag"
    });
    queueCloudOutbox(member);
    renderAll();
    await pushCloudRosterWithRetry({ silent: true });
    toast(`<strong>${escapeHtml(member.name)}</strong> marked reviewed.`, "success");
    playSfx("success");
  }

  function deleteMember(id) {
    if (!isAdmin) {
      openAdminModal();
      return;
    }
    const member = roster.find(item => item.id === id);
    if (!member) return;
    pendingDeleteId = id;
    el.deleteModalText.textContent = `Remove ${member.name} from the PH-L roster? This action cannot be undone.`;
    openModal("delete", el.deleteConfirmBtn);
  }

  function confirmDeleteMember() {
    if (!pendingDeleteId) return;
    const member = roster.find(item => item.id === pendingDeleteId);
    if (!member) {
      closeModal("delete");
      return;
    }
    roster = roster.filter(item => item.id !== pendingDeleteId);
    pendingDeletedIds.add(pendingDeleteId);
    if (editingId === pendingDeleteId) resetForm(false);
    if (drawerMemberId === pendingDeleteId) closeMemberDrawer();
    appendHistoryEvent({
      action: "delete",
      memberId: member.id,
      memberName: member.name,
      actor: adminSession?.name || "admin",
      fields: [{ field: "removed", from: member.name, to: "" }],
      note: "Member removed"
    });
    saveRoster();
    renderAll();
    pushCloudRosterWithRetry({ silent: true }).then(ok => {
      toast(
        ok
          ? `<strong>${escapeHtml(member.name)}</strong> removed from shared roster.`
          : `<strong>${escapeHtml(member.name)}</strong> removed locally. Cloud sync will retry.`,
        ok ? "success" : "error"
      );
    });
    playSfx("click");
    pendingDeleteId = null;
    closeModal("delete");
  }

  function renderScan() {
    state.apcs.forEach((apc, index) => {
      animateKpi(el.orbitValues[index], apc.cp, { suffix: "M", duration: 320 });
      el.orbitFactions[index].textContent = apc.faction;
    });

    const main = state.apcs[0].cp;
    const total = getTotalFromState();
    const status = STATUS[getStatusKey(state.level, main)];

    el.scanModeTag.textContent = stepMeta[currentStep].title;
    el.statusTag.textContent = status.label;
    el.statusTag.style.color = status.color;
    animateKpi(el.scanMain, main, { suffix: "M", duration: 360 });
    animateKpi(el.scanTotal, total, { suffix: "M", duration: 360 });
    animateKpi(el.scanAverage, total / getActiveApcCount(state.apcs), { suffix: "M", duration: 360 });
    const gap = getFrontlineGap(state.level, main);
    if (el.scanGap) {
      el.scanGap.textContent = formatGap(gap);
      el.scanGap.classList.toggle("gap-met", gap.met);
      el.scanGap.classList.toggle("gap-short", !gap.met && main > 0);
    }
    const role = classifyCurrentState();
    if (el.scanRallyRole) {
      if (role.pending) {
        el.scanRallyRole.textContent = "—";
        el.scanRallyRole.classList.remove("role-rl", "role-rj");
      } else {
        el.scanRallyRole.textContent = role.assigned_role;
        el.scanRallyRole.classList.toggle("role-rl", role.assigned_role === "RL");
        el.scanRallyRole.classList.toggle("role-rj", role.assigned_role === "RJ");
      }
    }
    if (el.scanLevelLabel) el.scanLevelLabel.textContent = formatLevel(state.level);
    const hasInput = state.name.trim() || state.apcs.some(apc => apc.cp > 0);
    if (el.liveBadge) el.liveBadge.hidden = !hasInput;

    document.getElementById("scanMetrics")?.classList.toggle("has-signal", hasInput);
  }

  function renderSummaryStrip() {
    let total = 0;
    let mainSum = 0;
    let apex = 0;

    roster.forEach(member => {
      total += getTotal(member);
      mainSum += getMain(member);
      if (getStatusKey(member.level, getMain(member)) === "apex") apex += 1;
    });

    const avgMain = roster.length ? mainSum / roster.length : 0;
    animateKpi(el.kpiMembers, roster.length, { decimals: 0, duration: 520 });
    animateKpi(el.kpiAlliancePower, total, {
      suffixHtml: "<small>M</small>",
      duration: 620
    });
    animateKpi(el.kpiAvgMain, avgMain, {
      suffixHtml: "<small>M</small>",
      duration: 620
    });
    animateKpi(el.kpiApexCount, apex, { decimals: 0, duration: 520 });
    animateKpi(el.kpiApexTotal, roster.length, { decimals: 0, duration: 520 });
    el.summaryStrip.classList.toggle("is-empty", roster.length === 0);
  }

  function renderReadiness() {
    if (!roster.length) {
      animateGauge(0);
      animateKpi(el.readinessValue, 0, { suffix: "%", decimals: 0, duration: 480 });
      el.readinessCopy.textContent = "Start adding PH-L members to calculate alliance readiness.";
      return;
    }

    let readinessSum = 0;
    let apexCount = 0;

    roster.forEach(member => {
      const statusKey = getStatusKey(member.level, getMain(member));
      readinessSum += Math.min(STATUS[statusKey].score + getBalance(member.apcs) * 0.12, 100);
      if (statusKey === "apex") apexCount += 1;
    });

    const readiness = readinessSum / roster.length;
    animateGauge(readiness);
    animateKpi(el.readinessValue, readiness, { suffix: "%", decimals: 0, duration: 700 });
    el.readinessCopy.textContent = readiness >= 80
      ? `${apexCount} members are hitting apex benchmarks.`
      : readiness >= 60
        ? "Solid roster base. Raise weaker APCs to improve battle readiness."
        : "Still building depth. Focus on stronger main APC values first.";
  }

  function animateGauge(targetPct) {
    const gauge = el.readinessGauge;
    if (!gauge) return;
    const from = Number(gauge.dataset.pct || 0);
    const to = Math.max(0, Math.min(100, Number(targetPct) || 0));
    gauge.dataset.pct = String(to);

    if (reducedMotion || Math.abs(from - to) < 0.05) {
      gauge.style.setProperty("--pct", to.toFixed(1));
      return;
    }

    const existing = kpiTweens.get(gauge);
    if (existing?.frame) cancelAnimationFrame(existing.frame);

    const start = performance.now();
    const duration = 700;
    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - ((1 - t) ** 3);
      const current = from + (to - from) * eased;
      gauge.style.setProperty("--pct", current.toFixed(1));
      if (t < 1) {
        const frame = requestAnimationFrame(tick);
        kpiTweens.set(gauge, { frame, value: to });
      } else {
        kpiTweens.set(gauge, { value: to });
      }
    };
    kpiTweens.set(gauge, { frame: requestAnimationFrame(tick), value: to });
  }

  function animateKpi(node, nextValue, options = {}) {
    if (!node) return;

    const {
      suffix = "",
      suffixHtml = "",
      decimals = 1,
      duration = 480
    } = options;

    const to = Number(nextValue) || 0;
    const stored = kpiTweens.get(node);
    const from = stored?.value ?? parseKpiNumber(node) ?? 0;

    const render = value => {
      const rounded = decimals === 0 ? Math.round(value) : Number(value.toFixed(decimals));
      const label = formatNumber(rounded);
      if (suffixHtml) node.innerHTML = `${label}${suffixHtml}`;
      else node.textContent = `${label}${suffix}`;
    };

    if (reducedMotion || Math.abs(from - to) < 0.01) {
      if (stored?.frame) cancelAnimationFrame(stored.frame);
      render(to);
      kpiTweens.set(node, { value: to });
      return;
    }

    if (stored?.frame) cancelAnimationFrame(stored.frame);
    node.classList.remove("kpi-pulse");
    void node.offsetWidth;
    node.classList.add("kpi-pulse");

    const start = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - ((1 - t) ** 3);
      const current = from + (to - from) * eased;
      render(current);
      if (t < 1) {
        const frame = requestAnimationFrame(tick);
        kpiTweens.set(node, { frame, value: to });
      } else {
        render(to);
        kpiTweens.set(node, { value: to });
        window.setTimeout(() => node.classList.remove("kpi-pulse"), 180);
      }
    };
    kpiTweens.set(node, { frame: requestAnimationFrame(tick), value: to });
  }

  function parseKpiNumber(node) {
    const raw = (node.textContent || "").replace(/[^\d.-]/g, "");
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  function renderRoster() {
    let filtered = roster;
    const query = el.searchInput.value.trim().toLowerCase();
    const level = el.levelFilter.value;
    const rank = el.rankFilter?.value || "all";
    const statusFilter = el.statusFilter.value;
    const sort = el.sortSelect.value;

    if (query) filtered = filtered.filter(member => member.name.toLowerCase().includes(query) || normalizePersonalCode(member.personalCode).includes(query.toUpperCase()));
    if (level !== "all") filtered = filtered.filter(member => member.level === level);
    if (rank !== "all") filtered = filtered.filter(member => member.rank === rank);
    if (statusFilter === "below-frontline") {
      filtered = filtered.filter(member => !getFrontlineGap(member.level, getMain(member)).met);
    } else if (statusFilter === "stale") {
      filtered = filtered.filter(member => Date.now() - Number(member.updated || 0) >= STALE_MS);
    } else if (statusFilter === "needs-review") {
      filtered = filtered.filter(member => memberNeedsReview(member));
    } else if (statusFilter === "rl" || statusFilter === "rj") {
      filtered = filtered.filter(member => {
        const role = getMemberRallyRole(member);
        return !role.pending && role.assigned_role === statusFilter.toUpperCase();
      });
    } else if (statusFilter !== "all") {
      filtered = filtered.filter(member => getStatusKey(member.level, getMain(member)) === statusFilter);
    }

    filtered = [...filtered].sort((a, b) => sortMembers(a, b, sort));
    el.resultText.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"} shown`;

    if (!filtered.length) {
      el.rosterList.innerHTML = `
        <div class="empty">
          <strong>${isAdmin ? "No roster signals found" : "Sign in required"}</strong>
          <p>${isAdmin
            ? "Create a member with Push Data to start the alliance roster."
            : "Enter your access code to continue."}</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-empty-action="start">Start guided entry</button>
          </div>
        </div>`;
      return;
    }

    el.rosterList.innerHTML = filtered.map(member => {
      const total = getTotal(member);
      const main = getMain(member);
      const st = STATUS[getStatusKey(member.level, main)];
      const gap = getFrontlineGap(member.level, main);
      const stale = Date.now() - Number(member.updated || 0) >= STALE_MS;
      const rally = getMemberRallyRole(member);
      const review = memberNeedsReview(member);
      return `
        <article class="member-card${review ? " is-needs-review" : ""}" style="--status:${st.color}" data-id="${member.id}">
          <div>
            <div class="member-tags">
              <button type="button" class="tag level field-tap" data-edit-field="level" data-id="${member.id}" title="Edit level">${formatLevel(member.level)}</button>
              <button type="button" class="tag field-tap" data-edit-field="rank" data-id="${member.id}" title="Edit rank">${member.rank}</button>
              <span class="tag status">${st.label}</span>
              <span class="tag ${rally.pending ? "" : (rally.assigned_role === "RL" ? "role-rl" : "role-rj")}">${rally.pending ? "—" : rally.assigned_role}</span>
              <span class="tag">${rally.specialty_faction}</span>
              <span class="tag ${gap.met ? "gap-ok" : "gap-bad"}">${formatGap(gap)}</span>
              ${stale ? '<span class="tag stale">Stale</span>' : ""}
              ${review ? `<button type="button" class="tag needs-review field-tap" data-edit-field="needsReview" data-id="${member.id}" title="Edit review flag">Needs review</button>` : ""}
              ${isAdmin && member.personalCode ? `<button type="button" class="tag personal-code field-tap" data-edit-field="personalCode" data-id="${member.id}" title="Edit Personal Code">${escapeHtml(member.personalCode)}</button>` : (member.personalCode ? `<span class="tag personal-code">${escapeHtml(member.personalCode)}</span>` : "")}
            </div>
            <button type="button" class="member-name field-tap" data-edit-field="name" data-id="${member.id}" title="Edit name">${escapeHtml(member.name)}</button>
            <div class="member-sub">${escapeHtml(getRallyGateReason(member))} · <button type="button" class="inline-field-tap" data-edit-field="plaza" data-id="${member.id}" title="Edit Plaza">Plaza ${formatTroops(member.rallyCapacity || 0)}</button> · Updated ${timeAgo(member.updated)}</div>
          </div>
          <div class="apc-bars">
            ${member.apcs.map((apc, i) => {
              const isApc4 = i >= REQUIRED_APC_COUNT;
              const apc4On = !isApc4 || memberHasApc4(member);
              if (isApc4 && !apc4On) {
                return `
              <div class="apc-row is-optional is-apc4-off">
                <label class="apc4-inline-check" data-action="toggle-apc4" data-id="${member.id}" data-enabled="1" title="Enable 4th APC">
                  <input type="checkbox" tabindex="-1">
                  <b>A4</b>
                </label>
                <span class="apc4-toggle">Off</span>
                <div class="bar"><div class="fill ${String(apc.faction || "fighter").toLowerCase()}" style="--w:0%"></div></div>
                <span class="row-val is-muted">—</span>
              </div>`;
              }
              const barMax = Math.max(getMaxForLevel(member.level), Number(apc.cp || 0), 1);
              return `
              <div class="apc-row${isApc4 ? " is-optional" : ""}">
                ${isApc4
                  ? `<label class="apc4-inline-check is-on" data-action="toggle-apc4" data-id="${member.id}" data-enabled="0" title="Turn 4th APC off">
                       <input type="checkbox" checked tabindex="-1">
                       <b>A4</b>
                     </label>`
                  : `<b title="APC ${i + 1}">A${i + 1}</b>`}
                <button type="button" class="faction ${apc.faction.toLowerCase()} field-tap" data-edit-field="apc${i}.faction" data-id="${member.id}" title="Edit APC ${i + 1} faction">${apc.faction}</button>
                <div class="bar"><div class="fill ${String(apc.faction || "fighter").toLowerCase()}" style="--w:${Math.min(100, (Number(apc.cp || 0) / barMax) * 100).toFixed(1)}%"></div></div>
                <button type="button" class="row-val field-tap" data-edit-field="apc${i}.cp" data-id="${member.id}" title="Edit APC ${i + 1} CP">${formatNumber(apc.cp)}<small>M</small></button>
              </div>`;
            }).join("")}
          </div>
          <div class="score-box"><span>Total APC CP</span><strong>${formatNumber(total)}<small>M</small></strong></div>
          <div class="card-actions">
            ${member.personalCode
              ? `<button class="card-action code-action" type="button" data-action="copy-code" data-code="${escapeHtml(member.personalCode)}" title="Copy Personal Code">Code</button>`
              : (isAdmin
                ? `<button class="card-action code-action generate" type="button" data-action="generate-code" data-id="${member.id}" title="Generate Personal Code">Gen</button>`
                : "")}
            ${isAdmin && review ? `<button class="card-action ok-action" type="button" data-action="clear-review" data-id="${member.id}" title="Mark reviewed">OK</button>` : ""}
            ${isAdmin ? `<button class="card-action delete" type="button" data-action="delete" data-id="${member.id}" title="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 14H7L7 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>
            </button>` : ""}
          </div>
        </article>`;
    }).join("");
  }

  function renderRanking() {
    const top = [...roster].sort((a, b) => getTotal(b) - getTotal(a)).slice(0, 5);
    if (!top.length) {
      el.rankingList.innerHTML = '<div class="empty"><strong>No ranking yet</strong><p>Add PH-L members to compare power.</p></div>';
      return;
    }

    el.rankingList.innerHTML = top.map((member, index) => `
      <div class="rank-item">
        <div class="rank-no">#${index + 1}</div>
        <div>
          <div class="rank-name">${escapeHtml(member.name)}</div>
          <div class="rank-sub">${formatLevel(member.level)} · ${member.rank} · ${(() => { const r = getMemberRallyRole(member); return r.pending ? "—" : r.assigned_role; })()} · ${formatGap(getFrontlineGap(member.level, getMain(member)))}</div>
        </div>
        <div class="rank-val">${formatNumber(getTotal(member))}<small>M</small></div>
      </div>`).join("");
  }

  function renderFactionCoverage() {
    if (!el.factionCoverage) return;
    if (!roster.length) {
      el.factionCoverage.innerHTML = '<div class="empty"><strong>No coverage yet</strong><p>Submit APC loadouts to see Fighter / Shooter / Rider depth.</p></div>';
      return;
    }

    const counts = { Fighter: 0, Shooter: 0, Rider: 0, Mixed: 0 };
    let slots = 0;
    roster.forEach(member => {
      member.apcs.forEach(apc => {
        if (Number(apc.cp) <= 0) return;
        slots += 1;
        counts[apc.faction] = (counts[apc.faction] || 0) + 1;
      });
    });

    el.factionCoverage.innerHTML = FACTIONS.map(faction => {
      const count = counts[faction] || 0;
      const pct = slots ? Math.round((count / slots) * 100) : 0;
      return `
        <div class="coverage-row">
          <div class="coverage-label"><span class="faction ${faction.toLowerCase()}">${faction}</span><b>${count}</b></div>
          <div class="coverage-bar"><div class="fill" style="--w:${pct}%"></div></div>
          <span class="coverage-pct">${pct}%</span>
        </div>`;
    }).join("");
  }

  function renderRallySplit() {
    if (!el.kpiRl || !el.kpiRj) return;

    syncRallyCriteriaControls();
    const thresholds = getAllianceRallyThresholds();
    const rosterAvailable = isAdmin && Array.isArray(roster);
    const canExpand = rosterAvailable && thresholds.ready;

    if (!thresholds.ready) {
      if (kpiTweens.has(el.kpiRl)) {
        const stored = kpiTweens.get(el.kpiRl);
        if (stored?.frame) cancelAnimationFrame(stored.frame);
      }
      if (kpiTweens.has(el.kpiRj)) {
        const stored = kpiTweens.get(el.kpiRj);
        if (stored?.frame) cancelAnimationFrame(stored.frame);
      }
      el.kpiRl.textContent = "—";
      el.kpiRj.textContent = "—";
      kpiTweens.set(el.kpiRl, { value: 0 });
      kpiTweens.set(el.kpiRj, { value: 0 });
      setRallyTeamExpandEnabled(false);
      collapseRallyTeamPanels();
      clearRallyTeamLists();
      renderRallyFormations([], thresholds);
      if (el.rallyRuleCopy) el.rallyRuleCopy.textContent = thresholds.label;
      return;
    }

    const saved = roster.map(getMemberRallyRole);
    const leaders = saved
      .filter(m => m.assigned_role === "RL")
      .sort((a, b) => Number(b.max_apc_cp) - Number(a.max_apc_cp));
    const joiners = saved
      .filter(m => m.assigned_role === "RJ")
      .sort((a, b) => Number(b.max_apc_cp) - Number(a.max_apc_cp));
    const summary = { rl: leaders.length, rj: joiners.length };
    animateKpi(el.kpiRl, summary.rl, { decimals: 0, duration: 420 });
    animateKpi(el.kpiRj, summary.rj, { decimals: 0, duration: 420 });

    setRallyTeamExpandEnabled(canExpand);
    if (!canExpand) {
      collapseRallyTeamPanels();
      clearRallyTeamLists();
    } else {
      renderRallyTeamList("rl", leaders, thresholds);
      renderRallyTeamList("rj", joiners, thresholds);
      syncRallyTeamPanelVisibility();
    }

    renderRallyFormations(saved, thresholds);

    if (el.rallyRuleCopy) {
      const draft = hasDraftRallySignal() ? classifyCurrentState() : null;
      const draftNote = draft && !draft.pending ? ` · Form: ${draft.assigned_role}` : "";
      el.rallyRuleCopy.textContent = `${thresholds.label}${draftNote}`;
    }
  }

  function toggleRallyTeamPanel(role) {
    if (!isAdmin || !getAllianceRallyThresholds().ready) return;
    const key = role === "rj" ? "rj" : "rl";
    rallyTeamExpanded[key] = !rallyTeamExpanded[key];
    syncRallyTeamPanelVisibility();
    playSfx("click");
  }

  function setRallyTeamExpandEnabled(enabled) {
    [el.kpiRlBtn, el.kpiRjBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.title = enabled
        ? (btn === el.kpiRlBtn ? "Show or hide Rally Leaders" : "Show or hide Rally Joiners")
        : "Alliance roster required to expand teams";
    });
  }

  function collapseRallyTeamPanels() {
    rallyTeamExpanded.rl = false;
    rallyTeamExpanded.rj = false;
    syncRallyTeamPanelVisibility();
  }

  function syncRallyTeamPanelVisibility() {
    const showRl = Boolean(rallyTeamExpanded.rl);
    const showRj = Boolean(rallyTeamExpanded.rj);
    if (el.rallyTeamRl) el.rallyTeamRl.hidden = !showRl;
    if (el.rallyTeamRj) el.rallyTeamRj.hidden = !showRj;
    if (el.kpiRlBtn) el.kpiRlBtn.setAttribute("aria-expanded", String(showRl));
    if (el.kpiRjBtn) el.kpiRjBtn.setAttribute("aria-expanded", String(showRj));
  }

  function clearRallyTeamLists() {
    if (el.rallyLeaderList) el.rallyLeaderList.innerHTML = "";
    if (el.rallyJoinerList) el.rallyJoinerList.innerHTML = "";
  }

  function renderRallyTeamList(role, members, thresholds) {
    const listEl = role === "rj" ? el.rallyJoinerList : el.rallyLeaderList;
    if (!listEl) return;
    const isRl = role !== "rj";
    const rowClass = isRl ? "rally-leader-row" : "rally-joiner-row";
    const emptyLabel = isRl
      ? `No Rally Leaders at or above ${formatThresholdSummary(thresholds)}.`
      : `No Rally Joiners below ${formatThresholdSummary(thresholds)}.`;

    if (!members.length) {
      listEl.innerHTML = `<div class="rally-leader-empty">${emptyLabel}</div>`;
      return;
    }

    listEl.innerHTML = members.map(m => {
      const maxCp = Number(m.max_apc_cp);
      const maxM = maxCp >= 10_000 ? maxCp / 1_000_000 : maxCp;
      const meta = isRl
        ? `${m.specialty_faction} · Highest APC ${formatNumber(maxM)}M · Plaza ${formatTroops(m.rally_capacity || 0)}`
        : `${m.specialty_faction} · Highest APC ${formatNumber(maxM)}M`;
      return `<div class="${rowClass}" role="listitem"><b>${escapeHtml(m.name)}</b><span>${escapeHtml(meta)}</span></div>`;
    }).join("");
  }

  function renderRallyFormations() {
    // Suggested strike-team matchmaking UI removed.
  }

  function syncRallyCriteriaControls() {
    const live = getAllianceRallyThresholds();
    if (el.rallyRosterReadout) el.rallyRosterReadout.hidden = false;
    if (el.rallyReadoutApc) {
      el.rallyReadoutApc.textContent = live.ready
        ? `${formatNumber(live.minApcM)}M`
        : "—";
    }
    if (el.rallyReadoutSamples) {
      el.rallyReadoutSamples.textContent = live.sampleApc > 0
        ? String(live.sampleApc)
        : "—";
    }
  }

  /** Live uploaded roster median of each member's highest APC march — no custom targets. */
  function getAllianceRallyThresholds() {
    return getAllianceRallyThresholdsFromRoster();
  }

  function getAllianceRallyThresholdsFromRoster() {
    // Same non-demo uploaded members the admin roster shows; skip missing/zero max APC.
    const samples = roster
      .filter(member => !member.isDemo)
      .map(member => ({
        max_apc_cp: toAbsoluteCp(getMaxApcCp(member))
      }))
      .filter(sample => Number(sample.max_apc_cp) > 0);

    const derived = window.PHL_RALLY_ROLES?.deriveThresholdsFromRoster
      ? window.PHL_RALLY_ROLES.deriveThresholdsFromRoster(samples)
      : deriveThresholdsFromRosterFallback(samples);

    const minApcCp = Number(derived.minApcCp ?? derived.minApc1Cp) || 0;
    const minApcM = minApcCp >= 10_000 ? minApcCp / 1_000_000 : minApcCp;
    const sampleApc = Number(derived.sampleApc) || 0;
    const ready = sampleApc >= MIN_RALLY_ROSTER_SAMPLES && minApcCp > 0;

    return {
      ready,
      source: "roster",
      minApcM,
      minApcCp,
      sampleApc,
      label: !ready
        ? "Waiting for real uploads (highest APC CP) — median not ready yet."
        : `Median highest APC: ${formatNumber(minApcM)}M · ≥ median = RL · below = RJ · n=${sampleApc}`
    };
  }

  /** Inline median if rallyRoles.js failed to bind (e.g. script load conflict). */
  function deriveThresholdsFromRosterFallback(samples) {
    const apcs = (samples || [])
      .map(s => Number(s.max_apc_cp ?? s.apc1_cp))
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!apcs.length) return { minApcCp: 0, sampleApc: 0 };
    const mid = Math.floor(apcs.length / 2);
    const minApcCp = apcs.length % 2 ? apcs[mid] : (apcs[mid - 1] + apcs[mid]) / 2;
    return { minApcCp, sampleApc: apcs.length };
  }

  function formatThresholdSummary(thresholds) {
    if (!thresholds?.ready) return "insufficient alliance data";
    return `Median highest APC ${formatNumber(thresholds.minApcM)}M`;
  }

  /**
   * Recalculate RL/RJ from saved roster + current form entry.
   * Call on every relevant load/input so categories stay live.
   */
  function syncLiveRallyClassification(options = {}) {
    const role = classifyCurrentState();
    if (!options.skipScan) renderScan();

    el.wizardContent.querySelectorAll("[data-live-rally-role], [data-checklist='role']").forEach(node => {
      if (role.pending) {
        node.textContent = "Waiting";
        node.classList.remove("gap-met", "gap-short");
      } else {
        node.textContent = role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner";
        node.classList.toggle("gap-met", role.assigned_role === "RL");
        node.classList.toggle("gap-short", role.assigned_role !== "RL");
      }
    });
    const thresholdsReady = getAllianceRallyThresholds().ready;
    el.wizardContent.querySelectorAll("[data-live-rally-waiting]").forEach(node => {
      node.hidden = thresholdsReady;
    });
    el.wizardContent.querySelectorAll("[data-live-rally-reason]").forEach(node => {
      node.textContent = formatRallyGateReasonForChecklist();
    });
    el.wizardContent.querySelectorAll("[data-live-plaza], [data-checklist='plaza']").forEach(node => {
      node.textContent = state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—";
    });

    if (isAdmin) {
      renderRallySplit();
      if (editingId) {
        clearTimeout(rallyRosterTimer);
        rallyRosterTimer = window.setTimeout(renderRoster, 100);
      }
    }
  }

  function hasDraftRallySignal() {
    return Boolean(
      editingId
      || state.name.trim()
      || Number(state.rallyCapacity) > 0
      || state.apcs.some(apc => Number(apc.cp) > 0)
    );
  }

  /** Roster as saved, with in-progress form values overlaid (edit) or appended (new entry). */
  function getLiveAllianceMembers() {
    const saved = roster.map(member => ({
      ...member,
      apcs: member.apcs.map(apc => ({ ...apc }))
    }));

    if (!hasDraftRallySignal()) return saved;

    const draft = {
      id: editingId || "__draft__",
      name: state.name.trim() || (editingId ? "Editing…" : "New entry"),
      level: state.level,
      rank: state.rank,
      rallyCapacity: Number(state.rallyCapacity || 0),
      updated: Date.now(),
      apcs: state.apcs.map(apc => ({ ...apc })),
      __draft: !editingId
    };

    if (editingId) {
      return saved.map(member => (member.id === editingId ? { ...member, ...draft, id: editingId } : member));
    }
    return [draft, ...saved];
  }

  function getLiveAllianceClassification() {
    return getLiveAllianceMembers().map(getMemberRallyRole);
  }

  function renderRefList(force = false) {
    if (!force && lastRenderedLevel === state.level) return;
    lastRenderedLevel = state.level;

    const band = BANDS[state.level];
    el.refList.innerHTML = `
      <div class="ref-item selected-reference">
        <strong>${formatLevel(state.level)}</strong>
        <div class="ref-values">
          <div><b>${band.operational}M</b>Operational</div>
          <div><b>${band.frontline}M</b>Frontline</div>
          <div><b>${band.apex}M</b>Apex</div>
        </div>
        <div class="reference-scope">
          <div><b>Tower</b>1–30</div>
          <div><b>Industrial</b>i1–i12</div>
        </div>
        <div class="reference-note">PH-L internal planning scale only. It is not a state-wide ranking or official game benchmark.</div>
      </div>`;
  }

  function applyAccessMode() {
    document.body.classList.toggle("admin-mode", isAdmin);
    document.body.classList.toggle("member-mode", isMember && !isAdmin);
    const who = adminSession?.name ? ` · ${adminSession.name}` : "";
    const mName = memberSession?.name ? ` · ${memberSession.name}` : "";
    let label = "Sign in";
    if (isAdmin) label = `Exit admin${who}`;
    else if (isMember) label = `Lock profile${mName}`;
    if (el.signInLabel) el.signInLabel.textContent = label;
    else if (el.adminAccessLabel) el.adminAccessLabel.textContent = label;
    el.signInBtn?.setAttribute("aria-pressed", String(isAdmin || isMember));
    el.signInBtn?.classList.toggle("is-unlocked", isAdmin || isMember);
    el.signInBtn?.classList.toggle("is-admin", isAdmin);
    el.signInBtn?.classList.toggle("is-member", isMember && !isAdmin);
    if (el.memberProfilePanel) {
      if (isMember && !isAdmin) el.memberProfilePanel.removeAttribute("hidden");
      else el.memberProfilePanel.setAttribute("hidden", "");
    }
    if (!isAdmin) {
      clearAdminViews();
      clearAdminCommsUi();
    }
    if (!isMember) clearMemberProfileUi();
  }

  function applyAdminMode() {
    applyAccessMode();
  }

  function handleSignInAccess() {
    if (isAdmin) {
      void logoutAdminSession({ toastMessage: "Session closed." });
      return;
    }
    if (isMember) {
      logoutMemberSession();
      return;
    }
    openAuthModal();
  }

  function handleMemberAccess() {
    if (isAdmin) {
      toast("Exit your current session to unlock another profile.", "error");
      return;
    }
    if (isMember) {
      logoutMemberSession();
      return;
    }
    openMemberModal();
  }

  function openAuthModal() {
    if (!el.authModal) return;
    if (el.authError) el.authError.textContent = "";
    if (el.authModalTitle) el.authModalTitle.textContent = "Sign in";
    if (el.authModalLead) el.authModalLead.textContent = "Enter your PH-L access code.";
    if (el.accessCodeInput) {
      el.accessCodeInput.value = recallPersonalCodeHint() || memberSession?.personalCode || "";
    }
    openModal("auth", el.accessCodeInput);
    playSfx("transition");
  }

  function openMemberModal() {
    openAuthModal();
  }

  function handleAdminAccess() {
    if (isAdmin) {
      void logoutAdminSession({ toastMessage: "Session closed." });
      return;
    }
    openAdminModal();
  }

  function openAdminModal() {
    openAuthModal();
  }

  function resolveModal(name) {
    if (name === "delete") return el.deleteModal;
    if (name === "sync") return el.syncModal;
    if (name === "personalCode") return el.personalCodeModal;
    if (name === "auth" || name === "admin" || name === "member") return el.authModal;
    return el.authModal;
  }

  function openModal(name, focusTarget) {
    const modal = resolveModal(name);
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(() => focusTarget?.focus(), 80);
  }

  function closeModal(name) {
    const modal = resolveModal(name);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (
      !el.authModal?.classList.contains("open")
      && !el.deleteModal?.classList.contains("open")
      && !el.syncModal?.classList.contains("open")
      && !el.personalCodeModal?.classList.contains("open")
      && !el.memberDrawer?.classList.contains("open")
    ) {
      document.body.classList.remove("modal-open");
    }
    if (name === "admin" || name === "member" || name === "auth") {
      if (el.authError) el.authError.textContent = "";
    }
    if (name === "delete") pendingDeleteId = null;
    if (name === "sync" && el.syncError) el.syncError.textContent = "";
    if (name === "personalCode") pendingPersonalCodeReveal = null;
    if (lastFocusedElement?.focus) lastFocusedElement.focus();
  }

  function openPersonalCodeModal(code) {
    if (el.personalCodeReveal) el.personalCodeReveal.textContent = code || "————";
    openModal("personalCode", el.personalCodeCopyBtn || el.personalCodeCloseBtn);
  }

  function copyRevealedPersonalCode() {
    const code = pendingPersonalCodeReveal || el.personalCodeReveal?.textContent || "";
    if (!code || code === "————") return;
    navigator.clipboard?.writeText(code).then(() => {
      toast("Personal Code copied. Keep it safe.", "success");
      playSfx("success");
    }).catch(() => {
      toast(`Your code: <strong>${escapeHtml(code)}</strong>`, "success");
    });
  }

  function setAuthError(message) {
    if (el.authError) el.authError.textContent = message;
    playSfx("error");
  }

  async function completeAdminLogin(account, code) {
    memberSession = null;
    isMember = false;
    sessionStorage.removeItem(MEMBER_SESSION_KEY);

    adminSession = {
      id: account.id,
      name: account.name,
      sessionId: createAdminSessionId(),
      code
    };
    isAdmin = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession));
    closeModal("auth");
    setSessionBanner("");
    applyAccessMode();
    await startAdminRealtime({ claim: true });
    await pullCloudRoster({ silent: true });
    await pullScheduledEvents({ silent: true });
    renderAll();
    toast(`Welcome, <strong>${escapeHtml(account.name)}</strong>.`, "success");
    playSfx("success");
  }

  async function completeMemberLogin(member, code) {
    memberSession = {
      personalCode: normalizePersonalCode(member.personalCode || code),
      memberId: member.id,
      name: member.name,
      rank: member.rank,
      roleTier: "R1-R3"
    };
    isMember = true;
    sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(memberSession));
    rememberPersonalCode(member.name, memberSession.personalCode);
    roster = [member];
    changeHistory = [];
    saveRoster();
    saveHistory();
    closeModal("auth");
    applyAccessMode();
    await pullScheduledEvents({ silent: true });
    renderAll();
    toast(`Unlocked <strong>${escapeHtml(member.name)}</strong>.`, "success");
    playSfx("success");
  }

  async function attemptUnlock() {
    const raw = (el.accessCodeInput?.value || "").trim();
    if (!raw) {
      setAuthError("Enter your access code.");
      return;
    }

    if (el.authUnlockBtn) el.authUnlockBtn.disabled = true;
    try {
      // Prefer admin hash match first; otherwise try personal code unlock.
      const hash = await sha256(raw);
      const account = getAdminAccounts().find(admin => admin.hash === hash);
      if (account) {
        await completeAdminLogin(account, raw);
        return;
      }

      if (!isCloudConfigured() || !usesNetlifyCloud()) {
        setAuthError("Invalid code.");
        return;
      }

      const code = normalizePersonalCode(raw);
      const response = await fetch(getConfig().cloudApiUrl, {
        cache: "no-store",
        headers: { "X-PHL-Personal-Code": code }
      });
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      if (response.status === 404 || !response.ok) {
        setAuthError("Invalid code.");
        el.accessCodeInput?.select();
        return;
      }
      const member = Array.isArray(data?.members) ? sanitizeMember(data.members[0]) : null;
      if (!member) {
        setAuthError("Invalid code.");
        return;
      }
      await completeMemberLogin(member, code);
    } catch {
      setAuthError("Invalid code.");
    } finally {
      if (el.authUnlockBtn) el.authUnlockBtn.disabled = false;
    }
  }

  // Back-compat aliases for any remaining call sites
  async function attemptAdminLogin() {
    return attemptUnlock();
  }

  async function attemptMemberLogin() {
    return attemptUnlock();
  }

  function logoutMemberSession({ toastMessage = "Personal profile locked.", playClick = true } = {}) {
    memberSession = null;
    isMember = false;
    sessionStorage.removeItem(MEMBER_SESSION_KEY);
    roster = [];
    changeHistory = [];
    saveRoster();
    saveHistory();
    applyAccessMode();
    renderAll();
    if (toastMessage) toast(toastMessage, "success");
    if (playClick) playSfx("click");
  }

  function loadMemberSession() {
    try {
      const raw = sessionStorage.getItem(MEMBER_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const personalCode = normalizePersonalCode(parsed?.personalCode);
      if (!personalCode || !parsed?.memberId) return null;
      return {
        personalCode,
        memberId: String(parsed.memberId),
        name: String(parsed.name || ""),
        rank: RANKS.includes(parsed.rank) ? parsed.rank : "R1",
        roleTier: "R1-R3"
      };
    } catch {
      return null;
    }
  }

  function enforceLocalRosterScope() {
    if (isAdmin) return;
    if (isMember && memberSession) {
      const code = normalizePersonalCode(memberSession.personalCode);
      roster = roster
        .map(sanitizeMember)
        .filter(Boolean)
        .filter(
          m =>
            m.id === memberSession.memberId ||
            normalizePersonalCode(m.personalCode) === code
        );
      changeHistory = [];
    } else {
      roster = [];
      changeHistory = [];
    }
    saveRoster();
    saveHistory();
  }

  function clearMemberProfileUi() {
    if (el.memberProfileList) el.memberProfileList.innerHTML = "";
    if (el.memberProfileResult) el.memberProfileResult.textContent = "Not unlocked";
  }

  function renderMemberProfile() {
    if (!el.memberProfileList || !isMember) return;
    const member = roster.find(
      m =>
        m.id === memberSession?.memberId ||
        normalizePersonalCode(m.personalCode) === normalizePersonalCode(memberSession?.personalCode)
    );
    if (!member) {
      el.memberProfileList.innerHTML = `<div class="empty"><strong>Profile not loaded</strong><p>Sign in again to unlock.</p></div>`;
      if (el.memberProfileResult) el.memberProfileResult.textContent = "0 profiles";
      return;
    }
    if (el.memberProfileTitle) el.memberProfileTitle.textContent = member.name;
    if (el.memberProfileSub) {
      el.memberProfileSub.textContent = `${member.rank || "R1"} · Personal Code ${member.personalCode || "—"} · tap fields to edit`;
    }
    if (el.memberProfileResult) el.memberProfileResult.textContent = "1 profile";

    // Reuse admin card markup into the member list (single record)
    const previousList = el.rosterList;
    const previousResult = el.resultText;
    el.rosterList = el.memberProfileList;
    el.resultText = el.memberProfileResult || previousResult;
    const savedFilter = {
      search: el.searchInput?.value,
      level: el.levelFilter?.value,
      rank: el.rankFilter?.value,
      status: el.statusFilter?.value,
      sort: el.sortSelect?.value
    };
    if (el.searchInput) el.searchInput.value = "";
    if (el.levelFilter) el.levelFilter.value = "all";
    if (el.rankFilter) el.rankFilter.value = "all";
    if (el.statusFilter) el.statusFilter.value = "all";
    if (el.sortSelect) el.sortSelect.value = "updated-desc";
    renderRoster();
    el.rosterList = previousList;
    el.resultText = previousResult;
    if (el.searchInput) el.searchInput.value = savedFilter.search || "";
    if (el.levelFilter) el.levelFilter.value = savedFilter.level || "all";
    if (el.rankFilter) el.rankFilter.value = savedFilter.rank || "all";
    if (el.statusFilter) el.statusFilter.value = savedFilter.status || "all";
    if (el.sortSelect) el.sortSelect.value = savedFilter.sort || "total-desc";
  }

  function getAdminAccounts() {
    const list = Array.isArray(getConfig().admins) ? getConfig().admins : [];
    return list
      .filter(admin => admin && admin.hash && admin.name)
      .map(admin => ({
        id: String(admin.id || admin.name).toLowerCase(),
        name: String(admin.name),
        hash: String(admin.hash).toLowerCase()
      }));
  }

  function loadAdminSession() {
    try {
      const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.id || !parsed?.name || !parsed?.code) return null;
      const stillValid = getAdminAccounts().some(admin => admin.id === parsed.id);
      if (!stillValid) return null;
      const sessionId = parsed.sessionId ? String(parsed.sessionId) : createAdminSessionId();
      const session = {
        id: parsed.id,
        name: parsed.name,
        sessionId,
        code: String(parsed.code)
      };
      if (!parsed.sessionId) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
      }
      return session;
    } catch {
      return null;
    }
  }

  function createAdminSessionId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getAdminRealtimeUrl() {
    const cfg = getConfig();
    if (cfg.adminRealtimeUrl) return String(cfg.adminRealtimeUrl).replace(/\/$/, "");
    if (cfg.cloudApiUrl) {
      return String(cfg.cloudApiUrl).replace(/\/api\/roster\/?$/, "/api/admin-realtime");
    }
    return "";
  }

  function isAdminRealtimeConfigured() {
    return Boolean(getAdminRealtimeUrl());
  }

  function adminRealtimePayload(extra = {}) {
    if (!adminSession?.id || !adminSession?.name || !adminSession?.sessionId || !adminSession?.code) return null;
    return {
      adminId: adminSession.id,
      adminName: adminSession.name,
      sessionId: adminSession.sessionId,
      adminCode: adminSession.code,
      ...extra
    };
  }

  async function postAdminRealtime(action, extra = {}) {
    const base = getAdminRealtimeUrl();
    const body = adminRealtimePayload(extra);
    if (!base || !body) return null;

    const response = await fetch(`${base}?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store"
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.status === 409 || data?.kicked) {
      handleAdminSessionKicked();
      return null;
    }

    if (!response.ok) {
      throw new Error(data?.error || `Admin realtime failed (${response.status})`);
    }

    return data;
  }

  async function startAdminRealtime({ claim = false } = {}) {
    if (!isAdmin || !adminSession) return;
    if (!adminSession.sessionId) {
      adminSession.sessionId = createAdminSessionId();
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession));
    }
    stopAdminRealtimePolling();
    if (!isAdminRealtimeConfigured()) {
      renderAdminOnline([]);
      if (el.adminChatLog) {
        el.adminChatLog.innerHTML = `<div class="admin-online-empty">Realtime channel not configured.</div>`;
      }
      return;
    }

    if (claim) {
      try {
        const claimed = await postAdminRealtime("claim");
        if (claimed?.online) renderAdminOnline(claimed.online);
      } catch {
        // claim is best-effort; heartbeat will retry
      }
    }

    await heartbeatAdminRealtime();
    adminRealtimeTimer = window.setInterval(() => {
      void heartbeatAdminRealtime();
    }, ADMIN_HEARTBEAT_MS);
  }

  function stopAdminRealtimePolling() {
    if (adminRealtimeTimer) {
      window.clearInterval(adminRealtimeTimer);
      adminRealtimeTimer = 0;
    }
    adminRealtimeBusy = false;
  }

  async function heartbeatAdminRealtime() {
    if (!isAdmin || !adminSession || adminRealtimeBusy) return;
    if (!isAdminRealtimeConfigured()) return;
    adminRealtimeBusy = true;
    try {
      const data = await postAdminRealtime("heartbeat");
      if (!data) return;
      if (Array.isArray(data.online)) renderAdminOnline(data.online);
      if (Array.isArray(data.messages)) renderAdminChat(data.messages);
    } catch {
      // transient network errors — next tick retries
    } finally {
      adminRealtimeBusy = false;
    }
  }

  async function onAdminChatSubmit(event) {
    event.preventDefault();
    if (!isAdmin || !adminSession) return;
    const text = el.adminChatInput?.value.trim() || "";
    if (!text) return;
    if (!isAdminRealtimeConfigured()) {
      toast("Admin chat is not configured.", "error");
      playSfx("error");
      return;
    }

    if (el.adminChatSend) el.adminChatSend.disabled = true;
    try {
      const data = await postAdminRealtime("chat", { text });
      if (!data) return;
      if (el.adminChatInput) el.adminChatInput.value = "";
      if (Array.isArray(data.online)) renderAdminOnline(data.online);
      if (Array.isArray(data.messages)) renderAdminChat(data.messages);
      playSfx("click");
    } catch {
      toast("Could not send admin message.", "error");
      playSfx("error");
    } finally {
      if (el.adminChatSend) el.adminChatSend.disabled = false;
      el.adminChatInput?.focus();
    }
  }

  function renderAdminOnline(online) {
    if (!el.adminOnlineList || !el.adminOnlineCount) return;
    const list = Array.isArray(online) ? online : [];
    const count = list.length;
    el.adminOnlineCount.textContent = `${count} online`;
    if (!count) {
      el.adminOnlineList.innerHTML = `<span class="admin-online-empty">No officers online</span>`;
      return;
    }
    el.adminOnlineList.innerHTML = list.map(row => {
      const name = escapeHtml(row.name || row.id || "Admin");
      const mine = row.id === adminSession?.id ? " (you)" : "";
      return `<span class="admin-online-chip"><span class="dot" aria-hidden="true"></span>${name}${mine}</span>`;
    }).join("");
  }

  function renderAdminChat(messages) {
    if (!el.adminChatLog) return;
    const list = Array.isArray(messages) ? messages : [];
    const stamp = list.map(msg => `${msg.id || ""}:${msg.at || ""}`).join("|");
    const stickToBottom =
      el.adminChatLog.scrollHeight - el.adminChatLog.scrollTop - el.adminChatLog.clientHeight < 48;

    if (!list.length) {
      el.adminChatLog.innerHTML = `<div class="admin-online-empty">No messages yet. Say hello to other admins.</div>`;
      lastAdminChatStamp = stamp;
      return;
    }

    if (stamp === lastAdminChatStamp) return;
    lastAdminChatStamp = stamp;

    el.adminChatLog.innerHTML = list.map(msg => {
      const mine = msg.adminId === adminSession?.id ? " mine" : "";
      const name = escapeHtml(msg.adminName || msg.adminId || "Admin");
      const body = escapeHtml(msg.text || "");
      const when = formatAdminChatTime(msg.at);
      return `<div class="admin-chat-msg${mine}"><div class="meta"><span>${name}</span><span>${when}</span></div><div class="body">${body}</div></div>`;
    }).join("");

    if (stickToBottom) {
      el.adminChatLog.scrollTop = el.adminChatLog.scrollHeight;
    }
  }

  function formatAdminChatTime(at) {
    const ts = Number(at);
    if (!Number.isFinite(ts) || ts <= 0) return "";
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function clearAdminCommsUi() {
    lastAdminChatStamp = "";
    if (el.adminOnlineCount) el.adminOnlineCount.textContent = "0 online";
    if (el.adminOnlineList) el.adminOnlineList.innerHTML = "";
    if (el.adminChatLog) el.adminChatLog.innerHTML = "";
    if (el.adminChatInput) el.adminChatInput.value = "";
  }

  function handleAdminSessionKicked() {
    if (!isAdmin && !adminSession) return;
    stopAdminRealtimePolling();
    isAdmin = false;
    adminSession = null;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    roster = [];
    changeHistory = [];
    saveRoster();
    saveHistory();
    applyAccessMode();
    renderAll();
    setSessionBanner(
      "Your session was taken over on another device. Sign in again if needed.",
      { actionLabel: "Sign in", onAction: () => openAdminModal() }
    );
    toast("Your admin session was taken over on another device.", "error");
    playSfx("error");
  }

  async function logoutAdminSession({ toastMessage = "Leadership session closed.", playClick = true } = {}) {
    stopAdminRealtimePolling();
    const base = getAdminRealtimeUrl();
    const body = adminRealtimePayload();
    if (base && body) {
      try {
        await fetch(`${base}?action=logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store"
        });
      } catch {
        // best-effort logout presence cleanup
      }
    }
    isAdmin = false;
    adminSession = null;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    // Drop leadership-loaded roster from memory
    roster = [];
    changeHistory = [];
    saveRoster();
    saveHistory();
    applyAccessMode();
    renderAll();
    toast(toastMessage, "success");
    if (playClick) playSfx("click");
  }

  async function sha256(value) {
    if (!globalThis.crypto?.subtle) {
      const fallback = getAdminAccounts().find(admin => admin.name === value);
      return fallback ? fallback.hash : "";
    }
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function clearAdminViews() {
    el.rosterList.innerHTML = "";
    el.resultText.textContent = "";
    el.rankingList.innerHTML = "";
    if (el.factionCoverage) el.factionCoverage.innerHTML = "";
    el.refList.innerHTML = "";
    if (el.historyList) el.historyList.innerHTML = "";
    if (el.historyResultText) el.historyResultText.textContent = "0 events";
    animateKpi(el.kpiMembers, 0, { decimals: 0, duration: 280 });
    animateKpi(el.kpiAlliancePower, 0, { suffixHtml: "<small>M</small>", duration: 280 });
    animateKpi(el.kpiAvgMain, 0, { suffixHtml: "<small>M</small>", duration: 280 });
    animateKpi(el.kpiApexCount, 0, { decimals: 0, duration: 280 });
    animateKpi(el.kpiApexTotal, 0, { decimals: 0, duration: 280 });
    if (el.kpiRl) animateKpi(el.kpiRl, 0, { decimals: 0, duration: 280 });
    if (el.kpiRj) animateKpi(el.kpiRj, 0, { decimals: 0, duration: 280 });
    setRallyTeamExpandEnabled(false);
    collapseRallyTeamPanels();
    clearRallyTeamLists();
    animateGauge(0);
    animateKpi(el.readinessValue, 0, { suffix: "%", decimals: 0, duration: 280 });
    el.readinessCopy.textContent = "Sign in to view alliance readiness.";
    el.summaryStrip.classList.add("is-empty");
    lastRenderedLevel = null;
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    Object.entries(audioFiles).forEach(([name, src]) => {
      audio[name] = new Audio(src);
    });
  }

  function playSfx(name) {
    if (!sfxEnabled || !audioAvailable) return;
    const clip = audio[name];
    if (!clip) return;
    try {
      clip.currentTime = 0;
      clip.volume = name === "success" ? 0.38 : name === "error" ? 0.32 : 0.26;
      clip.play().catch(() => {});
    } catch {}
  }

  function initLofiPlayer() {
    if (!el.lofiPlayer || !el.lofiPlayBtn) return;

    if (el.lofiVolume) el.lofiVolume.value = String(lofiVolumePct);
    renderLofiPlaylist();
    syncLofiUi();
    loadYouTubeApi().then(createLofiYtPlayer).catch(err => {
      console.warn("YouTube API failed", err);
      toast("Could not load Lofi Girl player.", "error");
    });

    el.lofiPlayBtn.addEventListener("click", () => {
      if (lofiPlaying) pauseLofi();
      else playLofi();
    });
    el.lofiPrevBtn?.addEventListener("click", () => {
      selectLofiTrack((lofiIndex - 1 + LOFI_PLAYLIST.length) % LOFI_PLAYLIST.length, lofiPlaying);
    });
    el.lofiNextBtn?.addEventListener("click", () => {
      selectLofiTrack((lofiIndex + 1) % LOFI_PLAYLIST.length, lofiPlaying);
    });
    el.lofiNowBtn?.addEventListener("click", () => {
      toggleLofiPlaylist();
    });
    el.lofiVolume?.addEventListener("input", () => {
      lofiVolumePct = Math.max(0, Math.min(100, Number(el.lofiVolume.value) || 0));
      prefs.lofiVolume = lofiVolumePct / 100;
      savePrefs();
      applyLofiVolume();
    });
    el.lofiPlaylist?.addEventListener("click", event => {
      const btn = event.target.closest("[data-lofi-index]");
      if (!btn) return;
      selectLofiTrack(Number(btn.dataset.lofiIndex), true);
      closeLofiPlaylist();
    });
    document.addEventListener("click", event => {
      if (!el.lofiPlayer?.contains(event.target)) closeLofiPlaylist();
    });
  }

  function loadYouTubeApi() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }
      const existing = document.querySelector("script[data-phl-yt]");
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        if (window.YT && window.YT.Player) resolve(window.YT);
        else reject(new Error("YT missing after ready"));
      };
      if (!existing) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.async = true;
        tag.dataset.phlYt = "1";
        tag.onerror = () => reject(new Error("YouTube iframe API script failed"));
        document.head.appendChild(tag);
      }
      window.setTimeout(() => {
        if (window.YT && window.YT.Player) resolve(window.YT);
      }, 4000);
    });
  }

  function createLofiYtPlayer(YT) {
    const mount = document.getElementById("lofiYtMount");
    if (!mount || lofiPlayerYt) return;
    const track = LOFI_PLAYLIST[lofiIndex] || LOFI_PLAYLIST[0];
    lofiPlayerYt = new YT.Player(mount, {
      width: 160,
      height: 90,
      videoId: track.youtubeId,
      host: "https://www.youtube.com",
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady(event) {
          lofiYtReady = true;
          try {
            event.target.setVolume(lofiVolumePct);
            event.target.unMute();
          } catch {}
          syncLofiUi();
          if (lofiPendingPlay) {
            lofiPendingPlay = false;
            playLofi(true);
          }
        },
        onStateChange(event) {
          const playing = event.data === YT.PlayerState.PLAYING;
          const buffering = event.data === YT.PlayerState.BUFFERING;
          lofiPlaying = playing || buffering;
          syncLofiUi();
        },
        onError(event) {
          console.warn("Lofi Girl YT error", event?.data);
          toast("Station unavailable — trying next…", "error");
          selectLofiTrack((lofiIndex + 1) % LOFI_PLAYLIST.length, true);
        }
      }
    });
  }

  function renderLofiPlaylist() {
    if (!el.lofiPlaylist) return;
    el.lofiPlaylist.innerHTML = LOFI_PLAYLIST.map((track, index) => `
      <button type="button" role="option" data-lofi-index="${index}" class="lofi-track${index === lofiIndex ? " is-active" : ""}" aria-selected="${index === lofiIndex ? "true" : "false"}">
        <span>${escapeHtml(track.title)}</span>
        <small>${escapeHtml(track.artist)}</small>
      </button>
    `).join("");
  }

  function syncLofiUi() {
    const track = LOFI_PLAYLIST[lofiIndex] || LOFI_PLAYLIST[0];
    if (el.lofiTrackTitle) el.lofiTrackTitle.textContent = track.title;
    if (el.lofiTrackArtist) el.lofiTrackArtist.textContent = track.artist;
    el.lofiPlayer?.setAttribute("data-playing", lofiPlaying ? "1" : "0");
    el.lofiPlayBtn?.classList.toggle("is-playing", lofiPlaying);
    el.lofiPlayBtn?.setAttribute("aria-label", lofiPlaying ? "Pause Lofi Girl radio" : "Play Lofi Girl radio");
    const playIcon = el.lofiPlayBtn?.querySelector(".lofi-icon-play");
    const pauseIcon = el.lofiPlayBtn?.querySelector(".lofi-icon-pause");
    if (playIcon) playIcon.hidden = lofiPlaying;
    if (pauseIcon) pauseIcon.hidden = !lofiPlaying;
    el.lofiPlaylist?.querySelectorAll("[data-lofi-index]").forEach(node => {
      const active = Number(node.dataset.lofiIndex) === lofiIndex;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function selectLofiTrack(index, autoplay) {
    lofiIndex = ((index % LOFI_PLAYLIST.length) + LOFI_PLAYLIST.length) % LOFI_PLAYLIST.length;
    prefs.lofiIndex = lofiIndex;
    savePrefs();
    syncLofiUi();
    if (autoplay) playLofi(true);
    else if (lofiPlayerYt && lofiYtReady) {
      try {
        lofiPlayerYt.cueVideoById(LOFI_PLAYLIST[lofiIndex].youtubeId);
      } catch {}
      pauseLofi();
    }
  }

  function playLofi(forceReload = false) {
    const track = LOFI_PLAYLIST[lofiIndex];
    if (!track) return;
    if (!lofiYtReady || !lofiPlayerYt) {
      lofiPendingPlay = true;
      lofiPlaying = true;
      syncLofiUi();
      return;
    }
    try {
      applyLofiVolume();
      if (forceReload) lofiPlayerYt.loadVideoById(track.youtubeId);
      else lofiPlayerYt.playVideo();
      lofiPlaying = true;
      syncLofiUi();
    } catch (err) {
      console.warn("Lofi play failed", err);
      lofiPlaying = false;
      syncLofiUi();
      toast("Could not start Lofi Girl. Click play again.", "error");
    }
  }

  function pauseLofi() {
    lofiPendingPlay = false;
    lofiPlaying = false;
    try { lofiPlayerYt?.pauseVideo(); } catch {}
    syncLofiUi();
  }

  function applyLofiVolume() {
    if (!lofiPlayerYt || !lofiYtReady) return;
    try {
      lofiPlayerYt.setVolume(lofiVolumePct);
      if (lofiVolumePct <= 0) lofiPlayerYt.mute();
      else lofiPlayerYt.unMute();
    } catch {}
  }

  function toggleLofiPlaylist() {
    if (!el.lofiPlaylist || !el.lofiNowBtn) return;
    const open = el.lofiPlaylist.hasAttribute("hidden");
    if (open) {
      el.lofiPlaylist.removeAttribute("hidden");
      el.lofiNowBtn.setAttribute("aria-expanded", "true");
      el.lofiPlayer?.classList.add("playlist-open");
    } else {
      closeLofiPlaylist();
    }
  }

  function closeLofiPlaylist() {
    if (!el.lofiPlaylist) return;
    el.lofiPlaylist.setAttribute("hidden", "");
    el.lofiNowBtn?.setAttribute("aria-expanded", "false");
    el.lofiPlayer?.classList.remove("playlist-open");
  }

  function startParticles() {
    const canvas = document.getElementById("fxCanvas");
    const ctx = canvas.getContext("2d");
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    const particles = [];
    let running = !document.hidden;
    let particleFrame = 0;

    function resize() {
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      particles.length = 0;
      for (let i = 0; i < 28; i += 1) {
        particles.push(createParticle());
      }
    }

    function createParticle() {
      return {
        x: Math.random() * innerWidth,
        y: innerHeight + Math.random() * 180,
        vx: (Math.random() - 0.5) * 0.35,
        vy: -(0.6 + Math.random() * 1.5),
        r: 1 + Math.random() * 2.5,
        a: 0.25 + Math.random() * 0.7,
        c: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]
      };
    }

    function loop() {
      if (!running) {
        particleFrame = 0;
        return;
      }
      particleFrame = requestAnimationFrame(loop);

      ctx.clearRect(0, 0, innerWidth, innerHeight);
      particles.forEach(particle => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.a -= 0.0026;
        if (particle.a <= 0 || particle.y < -20) Object.assign(particle, createParticle());
        ctx.globalAlpha = Math.max(0, particle.a);
        ctx.fillStyle = particle.c;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    let resizeTimer = 0;
    resize();
    seed();
    loop();

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        seed();
      }, 120);
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running && !particleFrame) loop();
    });
  }

  function enableTilt(card) {
    if (!card || card.dataset.bound || reducedMotion) return;
    card.dataset.bound = "1";

    let frame = 0;
    let targetTransform = "perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0)";

    const applyTransform = () => {
      frame = 0;
      card.style.transform = targetTransform;
    };

    card.addEventListener("pointermove", event => {
      card.classList.add("is-tilting");
      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) - 0.5;
      const y = ((event.clientY - rect.top) / rect.height) - 0.5;
      targetTransform = `perspective(1200px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg) translateY(-2px)`;
      if (!frame) frame = requestAnimationFrame(applyTransform);
    }, { passive: true });

    card.addEventListener("pointerleave", () => {
      card.classList.remove("is-tilting");
      targetTransform = "perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0)";
      if (!frame) frame = requestAnimationFrame(applyTransform);
    });
  }

  function buildInternalBands() {
    const bands = {};
    for (let level = 1; level <= 30; level += 1) {
      const ratio = level / 30;
      bands[`WT${level}`] = {
        operational: roundTo5(5 + 115 * ratio),
        frontline: roundTo5(10 + 170 * ratio),
        apex: roundTo5(15 + 235 * ratio)
      };
    }

    const anchors = {
      I1: [170, 250, 350],
      I2: [220, 330, 450],
      I3: [300, 450, 600],
      I4: [400, 580, 750],
      I5: [520, 700, 850]
    };

    Object.entries(anchors).forEach(([key, values]) => {
      bands[key] = { operational: values[0], frontline: values[1], apex: values[2] };
    });

    let previous = bands.I5;
    for (let level = 6; level <= 12; level += 1) {
      previous = {
        operational: roundTo5(previous.operational * 1.18),
        frontline: roundTo5(previous.frontline * 1.18),
        apex: roundTo5(previous.apex * 1.18)
      };
      bands[`I${level}`] = previous;
    }

    return bands;
  }

  function buildLevelOptions() {
    const towerOptions = TOWER_LEVELS.map(level => `<option value="${level}">${formatLevel(level)}</option>`).join("");
    const industryOptions = INDUSTRY_LEVELS.map(level => `<option value="${level}">${formatLevel(level)}</option>`).join("");
    return `<optgroup label="1–30">${towerOptions}</optgroup><optgroup label="i1–i12">${industryOptions}</optgroup>`;
  }

  function levelOptionsHtml(selected = "") {
    if (!selected) return LEVEL_OPTIONS;
    return LEVEL_OPTIONS.replace(
      new RegExp(`(value="${selected}")(?=[\\s>])`),
      `$1 selected`
    );
  }

  function rankOptionsHtml(selected) {
    return RANK_OPTIONS.replace(
      new RegExp(`(value="${selected}")(?=[\\s>])`),
      `$1 selected`
    );
  }

  function enhanceSelects(root = document) {
    if (!root) return;
    root.querySelectorAll("select").forEach(wrapUiSelect);
  }

  function wrapUiSelect(select) {
    if (select.closest(".ui-select")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "ui-select";
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add("ui-select-native");
    select.tabIndex = -1;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ui-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    if (select.id) trigger.id = `${select.id}-trigger`;

    const valueSpan = document.createElement("span");
    valueSpan.className = "ui-select-value";
    trigger.appendChild(valueSpan);

    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("class", "ui-select-chevron");
    chevron.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M7 10l5 5 5-5z");
    chevron.appendChild(path);
    trigger.appendChild(chevron);

    const menu = document.createElement("ul");
    menu.className = "ui-select-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    wrapper.insertBefore(trigger, select);
    wrapper.insertBefore(menu, select);
    buildUiSelectMenu(select, menu);

    trigger.addEventListener("click", event => {
      event.stopPropagation();
      const isOpen = wrapper.classList.contains("is-open");
      closeAllUiSelects();
      if (!isOpen) openUiSelect(wrapper);
    });

    select.addEventListener("change", () => syncUiSelect(select));
    syncUiSelect(select);
  }

  function buildUiSelectMenu(select, menu) {
    menu.innerHTML = "";
    Array.from(select.children).forEach(child => {
      if (child.tagName === "OPTGROUP") {
        const group = document.createElement("li");
        group.className = "ui-select-group";
        group.textContent = child.label;
        menu.appendChild(group);
        Array.from(child.children).forEach(option => {
          if (option.tagName === "OPTION") appendUiSelectOption(select, menu, option);
        });
        return;
      }
      if (child.tagName === "OPTION") appendUiSelectOption(select, menu, child);
    });
  }

  function appendUiSelectOption(select, menu, option) {
    const item = document.createElement("li");
    item.className = "ui-select-option";
    item.setAttribute("role", "option");
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.tabIndex = -1;
    item.addEventListener("click", event => {
      event.stopPropagation();
      setSelectValue(select, option.value);
      closeAllUiSelects();
    });
    menu.appendChild(item);
  }

  function syncUiSelect(select) {
    const wrapper = select.closest(".ui-select");
    if (!wrapper) return;
    const selected = select.options[select.selectedIndex];
    const valueNode = wrapper.querySelector(".ui-select-value");
    if (valueNode) valueNode.textContent = selected ? selected.textContent : "";
    wrapper.querySelectorAll(".ui-select-option").forEach(node => {
      node.classList.toggle("is-selected", node.dataset.value === select.value);
      node.setAttribute("aria-selected", node.dataset.value === select.value ? "true" : "false");
    });
  }

  function setSelectValue(select, value) {
    select.value = value;
    syncUiSelect(select);
    // Custom UI menus only fired "change"; the form listens for "input".
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function openUiSelect(wrapper) {
    wrapper.classList.add("is-open");
    const trigger = wrapper.querySelector(".ui-select-trigger");
    const menu = wrapper.querySelector(".ui-select-menu");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    if (menu) menu.hidden = false;
  }

  function closeAllUiSelects() {
    document.querySelectorAll(".ui-select.is-open").forEach(wrapper => {
      wrapper.classList.remove("is-open");
      const trigger = wrapper.querySelector(".ui-select-trigger");
      const menu = wrapper.querySelector(".ui-select-menu");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    });
  }

  function closeUiSelectsOnOutsideClick(event) {
    if (!event.target.closest(".ui-select")) closeAllUiSelects();
  }

  function roundTo5(value) {
    return Math.max(5, Math.round(value / 5) * 5);
  }

  function getMain(member) {
    return Number(member.apcs?.[0]?.cp || 0);
  }

  /** Highest APC march CP across APC1–APC4 (skip empty/0). Millions units as stored. */
  function getMaxApcCp(member) {
    const apcs = member?.apcs || [];
    const has4 = memberHasApc4(member);
    let max = 0;
    for (let i = 0; i < apcs.length; i += 1) {
      if (i >= REQUIRED_APC_COUNT && !has4) continue;
      const cp = Number(apcs[i]?.cp || 0);
      if (cp > max) max = cp;
    }
    return max;
  }

  /** Best march for classification: highest CP slot + its faction. */
  function getBestApc(member) {
    const apcs = member?.apcs || [];
    const has4 = memberHasApc4(member);
    let best = { cp: 0, faction: "Fighter", index: 0 };
    for (let i = 0; i < apcs.length; i += 1) {
      if (i >= REQUIRED_APC_COUNT && !has4) continue;
      const cp = Number(apcs[i]?.cp || 0);
      if (cp > best.cp) {
        best = {
          cp,
          faction: ["Fighter", "Shooter", "Rider"].includes(apcs[i]?.faction) ? apcs[i].faction : "Fighter",
          index: i
        };
      }
    }
    return best;
  }

  function getTotal(member) {
    const has4 = memberHasApc4(member);
    return member.apcs.reduce((sum, apc, i) => {
      if (i >= REQUIRED_APC_COUNT && !has4) return sum;
      return sum + Number(apc.cp || 0);
    }, 0);
  }

  function getTotalFromState() {
    return state.apcs.reduce((sum, apc, i) => {
      if (i >= REQUIRED_APC_COUNT && !state.hasApc4) return sum;
      return sum + Number(apc.cp || 0);
    }, 0);
  }

  /** Count APCs with CP > 0 for averages (empty optional APC4 does not dilute). */
  function getActiveApcCount(apcs) {
    const filled = (apcs || []).filter((apc, i) => {
      if (i >= REQUIRED_APC_COUNT && !state.hasApc4) return false;
      return Number(apc.cp || 0) > 0;
    }).length;
    return Math.max(1, filled);
  }

  function getBalance(apcs) {
    const values = (apcs || []).map(apc => Number(apc.cp || 0)).filter(v => v > 0);
    if (!values.length) return 0;
    if (values.length === 1) return 100;
    const max = Math.max(...values);
    const min = Math.min(...values);
    return Math.max(0, Math.min(100, 100 - ((max - min) / max) * 100));
  }

  function getStatusKey(level, mainCp) {
    const band = BANDS[level] || BANDS.WT30;
    if (mainCp >= band.apex) return "apex";
    if (mainCp >= band.frontline) return "frontline";
    if (mainCp >= band.operational) return "operational";
    return "building";
  }

  function getBandLabel(level, cp) {
    return STATUS[getStatusKey(level, cp)].label;
  }

  function getMaxForLevel(level) {
    const apex = (BANDS[level] || BANDS.WT30).apex;
    return roundTo5(Math.max(apex + 50, apex * 1.16));
  }

  function formatLevel(level) {
    const value = String(level || "");
    if (value.startsWith("WT")) return value.slice(2);
    if (value.startsWith("I")) return `i${value.slice(1)}`;
    return value || "—";
  }

  function formatNumber(value) {
    const numeric = Number(value || 0);
    return NUMBER_FORMAT.format(numeric);
  }

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, Number(n || 0)));
  }

  function sortMembers(a, b, sort) {
    switch (sort) {
      case "name-asc": return a.name.localeCompare(b.name);
      case "main-desc": return getMain(b) - getMain(a);
      case "gap-asc": return getFrontlineGap(b.level, getMain(b)).gap - getFrontlineGap(a.level, getMain(a)).gap;
      case "updated-desc": return b.updated - a.updated;
      default: return getTotal(b) - getTotal(a);
    }
  }

  function cryptoId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 12);
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (!raw || typeof raw !== "object") return {};
      // Custom RL/RJ targets removed — median from live roster only.
      if (raw.rallyCriteria) {
        delete raw.rallyCriteria;
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(raw)); } catch {}
      }
      return raw;
    } catch {
      return {};
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }

  function getFrontlineGap(level, cp) {
    const target = (BANDS[level] || BANDS.WT30).frontline;
    const gap = target - Number(cp || 0);
    return { target, gap, met: gap <= 0 };
  }

  function formatGap(gapInfo) {
    if (!gapInfo) return "—";
    if (gapInfo.met) return `+${formatNumber(Math.abs(gapInfo.gap))}M`;
    if (!Number(gapInfo.target)) return "—";
    return `-${formatNumber(Math.max(0, gapInfo.gap))}M`;
  }

  function getConfig() {
    return window.PHL_CONFIG || {};
  }

  function isCloudConfigured() {
    const cfg = getConfig();
    return Boolean(cfg.cloudApiUrl || (cfg.supabaseUrl && cfg.supabaseAnonKey));
  }

  function usesNetlifyCloud() {
    return Boolean(getConfig().cloudApiUrl);
  }

  function getAllianceId() {
    return getConfig().allianceId || "phl";
  }

  function getCloudHeaders() {
    const cfg = getConfig();
    return {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
  }

  function getRosterAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const inlineCode = normalizePersonalCode(headers.personalCode || "");
    delete headers.personalCode;
    if (isAdmin && adminSession?.id && adminSession?.code) {
      headers["X-PHL-Admin-Id"] = adminSession.id;
      headers["X-PHL-Admin-Code"] = adminSession.code;
      if (adminSession.sessionId) headers["X-PHL-Admin-Session"] = adminSession.sessionId;
    } else if (memberSession?.personalCode) {
      headers["X-PHL-Personal-Code"] = normalizePersonalCode(memberSession.personalCode);
    } else if (inlineCode) {
      headers["X-PHL-Personal-Code"] = inlineCode;
    }
    return headers;
  }

  async function fetchMemberByPersonalCode(code) {
    const normalized = normalizePersonalCode(code);
    if (!normalized || !isCloudConfigured() || !usesNetlifyCloud()) return null;
    const response = await fetch(getConfig().cloudApiUrl, {
      cache: "no-store",
      headers: { "X-PHL-Personal-Code": normalized }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
    const data = await response.json();
    const member = Array.isArray(data?.members) ? sanitizeMember(data.members[0]) : null;
    return member;
  }

  async function pullMemberSelf({ silent = false } = {}) {
    if (!memberSession?.personalCode) return false;
    try {
      const member = await fetchMemberByPersonalCode(memberSession.personalCode);
      if (!member) {
        if (!silent) toast("Personal Code no longer found.", "error");
        logoutMemberSession({ toastMessage: "", playClick: false });
        return false;
      }
      const fingerprint = rosterFingerprint([member], member.updated);
      if (silent && fingerprint === lastCloudFingerprint && lastCloudFingerprint !== "") {
        return true;
      }
      lastCloudFingerprint = fingerprint;
      memberSession = {
        ...memberSession,
        memberId: member.id,
        name: member.name,
        rank: member.rank,
        personalCode: normalizePersonalCode(member.personalCode || memberSession.personalCode)
      };
      sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(memberSession));
      roster = [member];
      changeHistory = [];
      saveRoster();
      saveHistory();
      renderAll();
      return true;
    } catch {
      return false;
    }
  }

  function getCloudUrl() {
    const cfg = getConfig();
    return `${cfg.supabaseUrl.replace(/\/$/, "")}/rest/v1/phl_roster?alliance_id=eq.${encodeURIComponent(getAllianceId())}`;
  }

  function mergeRosterLists(baseList, incomingList) {
    const map = new Map();
    for (const member of [...(baseList || []), ...(incomingList || [])].map(sanitizeMember).filter(Boolean)) {
      if (member.isDemo) continue;
      const key = member.id;
      const prev = map.get(key);
      if (!prev || Number(member.updated || 0) >= Number(prev.updated || 0)) {
        const merged = { ...member };
        if (!merged.personalCode && prev?.personalCode) merged.personalCode = prev.personalCode;
        map.set(key, merged);
      } else if (prev && !prev.personalCode && member.personalCode) {
        map.set(key, { ...prev, personalCode: member.personalCode });
      }
    }
    const byName = new Map();
    for (const member of map.values()) {
      const nameKey = member.name.toLowerCase();
      const prev = byName.get(nameKey);
      if (!prev || Number(member.updated || 0) >= Number(prev.updated || 0)) {
        const merged = { ...member };
        if (!merged.personalCode && prev?.personalCode) merged.personalCode = prev.personalCode;
        byName.set(nameKey, merged);
      }
    }
    return [...byName.values()].sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
  }

  async function pullCloudRoster({ silent = false } = {}) {
    if (!isCloudConfigured()) {
      if (!silent) {
        if (el.syncError) el.syncError.textContent = "Cloud sync is not configured.";
        playSfx("error");
      }
      return false;
    }
    if (!isAdmin) {
      if (isMember) return pullMemberSelf({ silent });
      if (!silent) {
        if (el.syncError) el.syncError.textContent = "Leadership login required to pull the full roster.";
        playSfx("error");
      }
      return false;
    }
    try {
      let remoteMembers = [];
      let remoteHistory = [];
      let remoteUpdatedAt = null;
      if (usesNetlifyCloud()) {
        const response = await fetch(getConfig().cloudApiUrl, {
          cache: "no-store",
          headers: getRosterAuthHeaders()
        });
        if (!response.ok) throw new Error(`Pull failed (${response.status})`);
        const data = await response.json();
        if (data?.scope && data.scope !== "leadership") {
          throw new Error("Leadership credentials rejected by API");
        }
        remoteMembers = Array.isArray(data.members) ? data.members : [];
        remoteHistory = Array.isArray(data.history) ? data.history : [];
        remoteUpdatedAt = data.updated_at || null;
      } else {
        const response = await fetch(getCloudUrl(), { headers: getCloudHeaders() });
        if (!response.ok) throw new Error(`Pull failed (${response.status})`);
        const rows = await response.json();
        const row = rows[0];
        if (!row?.members) {
          if (!silent) {
            if (el.syncError) el.syncError.textContent = "No cloud roster yet. Push local data first.";
            playSfx("error");
          }
          return false;
        }
        remoteMembers = Array.isArray(row.members) ? row.members : [];
        remoteHistory = Array.isArray(row.history) ? row.history : [];
        remoteUpdatedAt = row.updated_at || null;
      }

      const fingerprint = rosterFingerprint(remoteMembers, remoteUpdatedAt);
      const unchanged = fingerprint === lastCloudFingerprint && lastCloudFingerprint !== "";
      if (unchanged && silent) {
        if (pendingDeletedIds.size) maybeAutoPushCloud();
        return true;
      }
      const changed = fingerprint !== lastCloudFingerprint && lastCloudFingerprint !== "";
      lastCloudFingerprint = fingerprint;

      const demos = roster.filter(member => member.isDemo);
      const previousIds = new Set(roster.filter(m => !m.isDemo).map(m => m.id));
      roster = [
        ...mergeRosterLists(roster.filter(m => !m.isDemo), remoteMembers)
          .filter(member => !pendingDeletedIds.has(member.id)),
        ...demos
      ];
      changeHistory = mergeHistoryLists(changeHistory, remoteHistory);
      saveRoster();
      saveHistory();
      renderAll();

      if (pendingDeletedIds.size) {
        maybeAutoPushCloud();
      }

      if (!silent) {
        toast("Cloud roster pulled.", "success");
        playSfx("success");
        closeModal("sync");
      } else if (changed && isAdmin) {
        const added = roster.filter(m => !m.isDemo && !previousIds.has(m.id)).length;
        toast(
          added
            ? `Roster updated from another admin (+${added}).`
            : "Roster updated from another admin.",
          "success"
        );
      }
      return true;
    } catch (error) {
      const msg = error?.message || "Pull failed.";
      if (/credentials rejected|401|403/i.test(msg) && isAdmin) {
        await logoutAdminSession({
          toastMessage: "Admin session invalid — please log in again.",
          playClick: false
        });
        setSessionBanner(
          "Your session was rejected. Sign in again.",
          { actionLabel: "Sign in", onAction: () => openAdminModal() }
        );
        return false;
      }
      if (!silent) {
        if (el.syncError) el.syncError.textContent = msg;
        playSfx("error");
      }
      return false;
    }
  }

  async function pushCloudRoster({ silent = false } = {}) {
    if (!isCloudConfigured()) {
      if (!silent) {
        if (el.syncError) el.syncError.textContent = "Cloud sync is not configured.";
        playSfx("error");
      }
      return false;
    }
    try {
      const deletedIds = isAdmin ? [...pendingDeletedIds] : [];
      if (usesNetlifyCloud()) {
        let members;
        let authHeaders;
        let historyPayload = [];

        if (isAdmin) {
          members = roster.filter(member => !member.isDemo);
          authHeaders = getRosterAuthHeaders({ "Content-Type": "application/json" });
          historyPayload = changeHistory;
        } else {
          const pending = readCloudOutbox();
          members = pending.length
            ? pending
            : roster.filter(m => !m.isDemo).slice(0, 5);
          if (!members.length) return true;
          // Only send Personal Code as AUTH when the member session is unlocked.
          // Brand-new codes on first submit must go as public payload fields, not session proof.
          const sessionCode = normalizePersonalCode(memberSession?.personalCode) || "";
          authHeaders = getRosterAuthHeaders({
            "Content-Type": "application/json",
            ...(sessionCode ? { personalCode: sessionCode } : {})
          });
        }

        const response = await fetch(getConfig().cloudApiUrl, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            alliance_id: getAllianceId(),
            members,
            history: historyPayload,
            deleted_ids: deletedIds,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) {
          let errMsg = `Push failed (${response.status})`;
          try {
            const errBody = await response.json();
            if (errBody?.error) errMsg = errBody.error;
          } catch { /* ignore */ }
          throw new Error(errMsg);
        }
        const data = await response.json();
        if (Array.isArray(data.members)) {
          if (isAdmin) {
            const demos = roster.filter(member => member.isDemo);
            roster = [...mergeRosterLists(members, data.members), ...demos];
            for (const id of deletedIds) {
              if (!roster.some(member => member.id === id)) pendingDeletedIds.delete(id);
            }
            if (Array.isArray(data.history)) {
              changeHistory = mergeHistoryLists(changeHistory, data.history);
              saveHistory();
            }
            lastCloudFingerprint = rosterFingerprint(data.members, data.updated_at);
          } else {
            // Keep only accepted self/submit rows — never absorb a full roster
            const accepted = data.members.map(sanitizeMember).filter(Boolean);
            if (isMember && memberSession) {
              const mine =
                accepted.find(
                  m =>
                    normalizePersonalCode(m.personalCode) ===
                      normalizePersonalCode(memberSession.personalCode) ||
                    m.id === memberSession.memberId
                ) || accepted[0];
              if (mine) {
                roster = [mine];
                memberSession = {
                  ...memberSession,
                  memberId: mine.id,
                  name: mine.name,
                  rank: mine.rank,
                  personalCode: normalizePersonalCode(mine.personalCode || memberSession.personalCode)
                };
                sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(memberSession));
              }
            } else if (accepted.length) {
              // Anonymous submit: do not retain alliance data locally
              const last = accepted[accepted.length - 1];
              roster = last ? [last] : [];
            }
            changeHistory = [];
            saveHistory();
          }
          saveRoster();
          renderAll();
        }
      } else {
        const cfg = getConfig();
        const payload = {
          alliance_id: getAllianceId(),
          members: roster.filter(member => !member.isDemo),
          updated_at: new Date().toISOString()
        };
        const response = await fetch(`${cfg.supabaseUrl.replace(/\/$/, "")}/rest/v1/phl_roster`, {
          method: "POST",
          headers: {
            ...getCloudHeaders(),
            Prefer: "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Push failed (${response.status})`);
      }
      if (!silent) {
        toast("Roster saved to cloud.", "success");
        playSfx("success");
        closeModal("sync");
      }
      return true;
    } catch (error) {
      if (!silent) {
        if (el.syncError) el.syncError.textContent = error.message || "Push failed.";
        playSfx("error");
      } else {
        console.warn("Cloud push failed:", error);
      }
      return false;
    }
  }

  function maybeAutoPushCloud() {
    if (!isCloudConfigured()) return;
    pushCloudRosterWithRetry({ silent: true });
  }

  async function pushCloudRosterWithRetry({ silent = false, attempts = 3 } = {}) {
    for (let i = 0; i < attempts; i += 1) {
      const ok = await pushCloudRoster({ silent: true });
      if (ok) {
        if (!silent && i === 0) {
          /* pushCloudRoster already toasts when silent=false; we call silent */
        }
        if (!silent) {
          toast("Roster saved to cloud.", "success");
          playSfx("success");
          closeModal("sync");
        }
        return true;
      }
      await new Promise(resolve => window.setTimeout(resolve, 600 * (i + 1)));
    }
    if (!silent) {
      if (el.syncError) el.syncError.textContent = "Cloud sync failed after retries.";
      playSfx("error");
    }
    return false;
  }

  function readCloudOutbox() {
    try {
      const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
      return Array.isArray(raw) ? raw.map(sanitizeMember).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writeCloudOutbox(list) {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
    } catch {
      /* ignore quota */
    }
  }

  function queueCloudOutbox(member) {
    const clean = sanitizeMember(member);
    if (!clean) return;
    const list = readCloudOutbox().filter(item => item.id !== clean.id && item.name.toLowerCase() !== clean.name.toLowerCase());
    list.push(clean);
    writeCloudOutbox(list);
  }

  function clearCloudOutboxMember(id) {
    writeCloudOutbox(readCloudOutbox().filter(item => item.id !== id));
  }

  async function flushCloudOutbox() {
    if (!isCloudConfigured()) return false;
    const pending = readCloudOutbox();
    if (!pending.length && !(isAdmin && pendingDeletedIds.size)) return true;
    if (isAdmin) {
      for (const member of pending) upsertMember(member);
      saveRoster();
    }
    const ok = await pushCloudRosterWithRetry({ silent: true });
    if (ok) writeCloudOutbox([]);
    return ok;
  }

  function rosterFingerprint(members, updatedAt) {
    const ids = (members || [])
      .map(m => `${m.id}:${m.updated || 0}`)
      .sort()
      .join("|");
    return `${updatedAt || ""}::${ids}`;
  }

  function startCloudSyncLoop() {
    if (!isCloudConfigured()) return;
    stopCloudSyncLoop();
    cloudSyncTimer = window.setInterval(() => {
      if (document.hidden) return;
      flushCloudOutbox()
        .then(() => {
          if (isAdmin) return pullCloudRoster({ silent: true });
          if (isMember) return pullMemberSelf({ silent: true });
          return Promise.resolve();
        })
        .catch(() => {});
    }, 12000);
    window.addEventListener("focus", onSharedWindowFocus);
    document.addEventListener("visibilitychange", onSharedVisibility);
  }

  function stopCloudSyncLoop() {
    if (cloudSyncTimer) {
      window.clearInterval(cloudSyncTimer);
      cloudSyncTimer = 0;
    }
    window.removeEventListener("focus", onSharedWindowFocus);
    document.removeEventListener("visibilitychange", onSharedVisibility);
  }

  function onSharedWindowFocus() {
    flushCloudOutbox()
      .then(() => {
        if (isAdmin) return pullCloudRoster({ silent: true });
        if (isMember) return pullMemberSelf({ silent: true });
        return Promise.resolve();
      })
      .catch(() => {});
  }

  function onSharedVisibility() {
    if (document.hidden) return;
    onSharedWindowFocus();
  }

  function exportJsonRoster() {
    const blob = new Blob([JSON.stringify({
      allianceId: getAllianceId(),
      exportedAt: new Date().toISOString(),
      members: roster
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `phl-roster-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast("JSON roster exported.", "success");
    playSfx("success");
  }

  function importJsonRoster(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        const members = Array.isArray(data) ? data : data.members;
        if (!Array.isArray(members)) throw new Error("Invalid roster JSON");
        roster = members.map(sanitizeMember).filter(Boolean);
        saveRoster();
        renderAll();
        maybeAutoPushCloud();
        toast(`Imported ${roster.length} members.`, "success");
        playSfx("success");
        closeModal("sync");
      } catch (error) {
        if (el.syncError) el.syncError.textContent = error.message || "Import failed.";
        playSfx("error");
      }
    };
    reader.readAsText(file);
  }

  function loadRoster() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map(sanitizeMember).filter(Boolean);
    } catch {
      return [];
    }
  }

  function sanitizeMember(item) {
    if (!item || typeof item !== "object") return null;
    const name = String(item.name || "").trim().slice(0, 30);
    if (!name) return null;
    const level = BANDS[item.level] ? item.level : "WT30";
    const rank = RANKS.includes(item.rank) ? item.rank : "R1";
    const personalCode = normalizePersonalCode(item.personalCode);
    const needsReview = Boolean(item.needsReview) || /\]-updt$/i.test(name) || /-updt$/i.test(name);
    const apcs = Array.from({ length: APC_COUNT }, (_, i) => ({
      cp: normalizeApcCp(item.apcs?.[i]?.cp || 0),
      faction: FACTIONS.includes(item.apcs?.[i]?.faction) ? item.apcs[i].faction : "Fighter"
    }));
    const hasApc4 =
      typeof item.hasApc4 === "boolean" ? item.hasApc4 : Number(apcs[REQUIRED_APC_COUNT]?.cp || 0) > 0;
    return {
      id: String(item.id || cryptoId()),
      name,
      level,
      rank,
      rallyCapacity: Math.max(0, Math.floor(Number(item.rallyCapacity || 0))),
      updated: Number(item.updated) || Date.now(),
      isDemo: Boolean(item.isDemo),
      personalCode: personalCode || undefined,
      needsReview,
      hasApc4,
      apcs
    };
  }

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return normalizeHistoryList(raw);
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(changeHistory.slice(0, HISTORY_CAP)));
    } catch {
      /* ignore quota */
    }
  }

  function normalizeHistoryList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(item => item && typeof item === "object")
      .map(item => ({
        id: String(item.id || cryptoId()),
        at: Number(item.at) || Date.now(),
        action: String(item.action || "update").slice(0, 40),
        memberId: String(item.memberId || "").slice(0, 64),
        memberName: String(item.memberName || "").trim().slice(0, 40),
        actor: String(item.actor || "member").trim().slice(0, 40),
        fields: Array.isArray(item.fields)
          ? item.fields.slice(0, 24).map(f => ({
              field: String(f?.field || "").slice(0, 40),
              from: String(f?.from ?? "").slice(0, 80),
              to: String(f?.to ?? "").slice(0, 80)
            }))
          : [],
        note: String(item.note || "").slice(0, 160)
      }))
      .filter(item => item.id)
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
      .slice(0, HISTORY_CAP);
  }

  function mergeHistoryLists(a, b) {
    const map = new Map();
    for (const event of [...normalizeHistoryList(a), ...normalizeHistoryList(b)]) {
      map.set(event.id, event);
    }
    return [...map.values()]
      .sort((x, y) => Number(y.at || 0) - Number(x.at || 0))
      .slice(0, HISTORY_CAP);
  }

  function appendHistoryEvent(partial) {
    const event = {
      id: cryptoId(),
      at: Date.now(),
      action: partial.action || "update",
      memberId: partial.memberId || "",
      memberName: partial.memberName || "",
      actor: partial.actor || "member",
      fields: Array.isArray(partial.fields) ? partial.fields : [],
      note: partial.note || ""
    };
    changeHistory = [event, ...changeHistory].slice(0, HISTORY_CAP);
    saveHistory();
    if (isAdmin && adminView === "history") renderHistory();
    return event;
  }

  function diffMemberFields(previous, next) {
    const fields = [];
    if (!previous) {
      fields.push({ field: "created", from: "", to: next?.name || "" });
      return fields;
    }
    const watch = ["name", "level", "rank", "rallyCapacity", "personalCode", "needsReview", "hasApc4"];
    for (const key of watch) {
      const from = previous[key];
      const to = next[key];
      if (String(from ?? "") !== String(to ?? "")) {
        fields.push({ field: key, from: String(from ?? ""), to: String(to ?? "") });
      }
    }
    for (let i = 0; i < APC_COUNT; i += 1) {
      const fromCp = Number(previous.apcs?.[i]?.cp || 0);
      const toCp = Number(next.apcs?.[i]?.cp || 0);
      const fromFac = previous.apcs?.[i]?.faction || "";
      const toFac = next.apcs?.[i]?.faction || "";
      if (fromCp !== toCp) fields.push({ field: `apc${i + 1}.cp`, from: String(fromCp), to: String(toCp) });
      if (fromFac !== toFac) fields.push({ field: `apc${i + 1}.faction`, from: fromFac, to: toFac });
    }
    return fields;
  }

  function renderHistory() {
    if (!el.historyList) return;
    const list = changeHistory;
    if (el.historyResultText) el.historyResultText.textContent = `${list.length} event${list.length === 1 ? "" : "s"}`;
    if (!list.length) {
      el.historyList.innerHTML = `<div class="empty"><strong>No changes yet</strong><p>Edits will appear here — member creates, Personal Code overwrites, and admin field edits.</p></div>`;
      return;
    }
    el.historyList.innerHTML = list.map(event => {
      const when = new Date(event.at).toLocaleString();
      const fieldText = (event.fields || []).length
        ? event.fields.map(f => `<b>${escapeHtml(f.field)}</b>: ${escapeHtml(f.from || "—")} → ${escapeHtml(f.to || "—")}`).join(" · ")
        : escapeHtml(event.note || "—");
      return `
        <article class="history-item">
          <div class="history-meta">
            <span class="history-action">${escapeHtml(event.action)}</span>
            <span>${escapeHtml(event.actor || "member")}</span>
            <span>${escapeHtml(when)}</span>
          </div>
          <div class="history-name">${escapeHtml(event.memberName || "Unknown")}</div>
          <div class="history-fields">${fieldText}</div>
        </article>`;
    }).join("");
  }

  function rememberPersonalCode(name, code) {
    if (!code) return;
    try {
      const map = JSON.parse(localStorage.getItem(PERSONAL_CODE_PREF_KEY) || "{}");
      const key = String(name || "").trim().toLowerCase() || "_last";
      map[key] = code;
      map._last = code;
      localStorage.setItem(PERSONAL_CODE_PREF_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }

  function recallPersonalCodeHint() {
    try {
      const map = JSON.parse(localStorage.getItem(PERSONAL_CODE_PREF_KEY) || "{}");
      return map._last || "";
    } catch {
      return "";
    }
  }

  function saveRoster() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
    } catch {
      toast("Could not save locally. Browser storage may be full or blocked.", "error");
      playSfx("error");
    }
  }

  /** Normalize CP to absolute game units.
   *  Console fields store millions (820 → 820M). Absolute values (>= 10k) pass through. */
  function toAbsoluteCp(cp) {
    const n = Number(cp || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n < 10_000) return Math.round(n * 1_000_000);
    return Math.round(n);
  }

  function classifyCurrentState() {
    const best = getBestApc(state);
    return classifyMemberPayload({
      id: editingId || "draft",
      name: state.name || "Draft",
      max_apc_cp: toAbsoluteCp(best.cp),
      rally_capacity: Number(state.rallyCapacity || 0),
      apc1_faction: best.faction
    });
  }

  function getMemberRallyRole(member) {
    const best = getBestApc(member);
    return classifyMemberPayload({
      id: member.id,
      name: member.name,
      max_apc_cp: toAbsoluteCp(best.cp),
      rally_capacity: Number(member.rallyCapacity || 0),
      apc1_faction: best.faction
    });
  }

  function classifyMemberPayload(input) {
    const thresholds = getAllianceRallyThresholds();
    const faction = ["Fighter", "Shooter", "Rider"].includes(input.apc1_faction) ? input.apc1_faction : "Fighter";
    if (!thresholds.ready) {
      return { ...input, assigned_role: "RJ", specialty_faction: faction, pending: true };
    }
    const gate = { minApcCp: thresholds.minApcCp };
    const api = window.PHL_RALLY_ROLES;
    if (api?.classifyMember) {
      return { ...api.classifyMember(input, gate), pending: false };
    }
    const cpOk = Number(input.max_apc_cp) >= gate.minApcCp;
    return { ...input, assigned_role: cpOk ? "RL" : "RJ", specialty_faction: faction, pending: false };
  }

  function getRallyGateReasonFromState() {
    return getRallyGateReason({
      rallyCapacity: state.rallyCapacity,
      apcs: state.apcs
    });
  }

  function rallyGateWaitingNoteHtml() {
    const ready = getAllianceRallyThresholds().ready;
    return `<div class="rally-gate-note" data-live-rally-waiting role="status"${ready ? " hidden" : ""}>Waiting for uploaded alliance CP</div>`;
  }

  function formatRallyGateReasonForChecklist() {
    const thresholds = getAllianceRallyThresholds();
    if (!thresholds.ready) return "—";
    return getRallyGateReasonFromState();
  }

  function getRallyGateReason(member) {
    const thresholds = getAllianceRallyThresholds();
    if (!thresholds.ready) return "Waiting for uploaded alliance CP";
    const best = getMaxApcCp(member);
    const absCp = toAbsoluteCp(best);
    const cpOk = absCp >= thresholds.minApcCp;
    if (cpOk) return `RL ≥ median ${formatNumber(thresholds.minApcM)}M`;
    return `Highest APC ${formatNumber(best)}M < median ${formatNumber(thresholds.minApcM)}M`;
  }

  function formatTroops(value) {
    const n = Number(value || 0);
    if (n >= 1_000_000) return `${formatNumber(n / 1_000_000)}M`;
    if (n >= 1_000) return `${formatNumber(n / 1_000)}k`;
    return String(n);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.innerHTML = message;
    el.toastRegion.appendChild(node);
    window.setTimeout(() => node.classList.add("fade"), 2800);
    window.setTimeout(() => node.remove(), 3300);
  }
})();
