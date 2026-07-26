
(() => {
  "use strict";

  const STORAGE_KEY = "phl_apex_console_v7";
  const PREFS_KEY = "phl_prefs_v1";
  const ADMIN_SESSION_KEY = "phl_admin_session_v2";
  const OUTBOX_KEY = "phl_cloud_outbox_v1";
  const HISTORY_KEY = "phl_roster_history_v1";
  const PERSONAL_CODE_PREF_KEY = "phl_my_personal_codes_v1";
  const ADMIN_HEARTBEAT_MS = 10_000;
  const APC_COUNT = 4;
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const HISTORY_CAP = 300;
  const MOBILE_MQ = "(max-width: 760px)";
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
  let entryMode = prefs.entryMode === "quick" ? "quick" : "guided";
  let sfxEnabled = true;
  let adminSession = loadAdminSession();
  let isAdmin = Boolean(adminSession);
  let audioUnlocked = false;
  let pendingDeletedIds = new Set();
  let cloudSyncTimer = 0;
  let adminRealtimeTimer = 0;
  let adminRealtimeBusy = false;
  let lastCloudFingerprint = "";
  let lastAdminChatStamp = "";
  let rosterFilterTimer = 0;
  let rallyRosterTimer = 0;
  let lastRenderedLevel = null;
  let wizardRailDirty = true;
  let audioAvailable = true;
  let pendingDeleteId = null;
  let lastFocusedElement = null;
  let mobileTab = "preview";
  let adminView = "roster";
  let drawerMemberId = null;
  let pendingPersonalCodeReveal = null;
  const kpiTweens = new WeakMap();

  const demoRoster = [
    // RL sample — KittyKlawzz
    buildMember("KittyKlawzz", "I5", "R4", [820, 760, 710, 655], ["Shooter", "Fighter", "Rider", "Mixed"], 450_000),
    // RL sample — Fisherman5
    buildMember("Fisherman5", "I5", "R4", [744, 698, 640, 612], ["Rider", "Rider", "Shooter", "Mixed"], 410_000),
    // RJ fillers (admin demo only)
    buildMember("Tea", "I4", "R4", [605, 562, 510, 480], ["Fighter", "Shooter", "Mixed", "Rider"], 320_000),
    buildMember("Tiger", "I4", "R3", [578, 540, 496, 452], ["Fighter", "Mixed", "Shooter", "Rider"], 280_000),
    buildMember("Bella", "I3", "R2", [460, 420, 395, 360], ["Shooter", "Shooter", "Fighter", "Mixed"], 200_000)
  ];

  const state = {
    name: "",
    level: prefs.lastLevel && BANDS[prefs.lastLevel] ? prefs.lastLevel : "WT30",
    rank: RANKS.includes(prefs.lastRank) ? prefs.lastRank : "R1",
    rallyCapacity: 0,
    personalCode: "",
    apcs: Array.from({ length: APC_COUNT }, () => ({ cp: 0, faction: "Fighter" }))
  };

  const stepMeta = [
    { key: "identity", title: "Operator identity", hint: "Start with the member name, level and alliance rank.", railTitle: "Identity", railHint: "Member info", icon: "01" },
    { key: "apc1", title: "APC 1 setup", hint: "Configure your main APC CP, faction and Rally Plaza capacity.", railTitle: "APC 1", railHint: "Main + Plaza", icon: "A1" },
    { key: "apc2", title: "APC 2 setup", hint: "Add the second APC and keep your loadout balanced.", railTitle: "APC 2", railHint: "Second APC", icon: "A2" },
    { key: "apc3", title: "APC 3 setup", hint: "Set the third APC power and faction focus.", railTitle: "APC 3", railHint: "Third APC", icon: "A3" },
    { key: "apc4", title: "APC 4 setup", hint: "Complete the fourth APC or leave it lower if unused.", railTitle: "APC 4", railHint: "Fourth APC", icon: "A4" },
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
    guidedModeBtn: document.getElementById("guidedModeBtn"),
    quickModeBtn: document.getElementById("quickModeBtn"),
    primaryBtn: document.getElementById("primaryBtn"),
    backBtn: document.getElementById("backBtn"),
    resetBtn: document.getElementById("resetBtn"),
    demoBtn: document.getElementById("demoBtn"),
    exportBtn: document.getElementById("exportBtn"),
    copyDiscordBtn: document.getElementById("copyDiscordBtn"),
    syncBtn: document.getElementById("syncBtn"),
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
    rallyCriteriaMode: document.getElementById("rallyCriteriaMode"),
    rallyManualFields: document.getElementById("rallyManualFields"),
    rallyRosterReadout: document.getElementById("rallyRosterReadout"),
    rallyReadoutApc: document.getElementById("rallyReadoutApc"),
    rallyReadoutPlaza: document.getElementById("rallyReadoutPlaza"),
    rallyMinApc1Input: document.getElementById("rallyMinApc1Input"),
    rallyMinPlazaInput: document.getElementById("rallyMinPlazaInput"),
    rallyRuleCopy: document.getElementById("rallyRuleCopy"),
    rallyLeaderList: document.getElementById("rallyLeaderList"),
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
    adminAccessBtn: document.getElementById("adminAccessBtn"),
    adminAccessLabel: document.getElementById("adminAccessLabel"),
    adminModal: document.getElementById("adminModal"),
    adminCodeInput: document.getElementById("adminCodeInput"),
    adminLoginBtn: document.getElementById("adminLoginBtn"),
    adminCancelBtn: document.getElementById("adminCancelBtn"),
    adminError: document.getElementById("adminError"),
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
    timesEventsPanel: document.getElementById("timesEventsPanel"),
    teServerClock: document.getElementById("teServerClock"),
    teServerBadge: document.getElementById("teServerBadge"),
    teLocalClock: document.getElementById("teLocalClock"),
    teLocalBadge: document.getElementById("teLocalBadge"),
    teEventInput: document.getElementById("teEventInput"),
    teOffsetSelect: document.getElementById("teOffsetSelect"),
    teConvertedTime: document.getElementById("teConvertedTime"),
    teConvertedMeta: document.getElementById("teConvertedMeta"),
    memberDrawer: document.getElementById("memberDrawer"),
    memberDrawerBody: document.getElementById("memberDrawerBody"),
    memberDrawerTitle: document.getElementById("memberDrawerTitle"),
    memberDrawerSub: document.getElementById("memberDrawerSub"),
    memberDrawerSave: document.getElementById("memberDrawerSave"),
    memberDrawerClose: document.getElementById("memberDrawerClose"),
    personalCodeModal: document.getElementById("personalCodeModal"),
    personalCodeReveal: document.getElementById("personalCodeReveal"),
    personalCodeCopyBtn: document.getElementById("personalCodeCopyBtn"),
    personalCodeCloseBtn: document.getElementById("personalCodeCloseBtn"),
    adminRosterPane: document.getElementById("adminRosterPane"),
    adminHistoryPane: document.getElementById("adminHistoryPane"),
    historyList: document.getElementById("historyList"),
    historyResultText: document.getElementById("historyResultText"),
    historyRefreshBtn: document.getElementById("historyRefreshBtn")
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
    bindEvents();
    initLofiPlayer();
    applyAdminMode();
    applyEntryMode();
    initMobileTabs();
    enhanceSelects(document.querySelector(".toolbar"));
    enhanceSelects(document.getElementById("rallyCriteriaBox"));
    initServerClockPanel();
    renderAll();
    probeAudioAssets();
    if (!reducedMotion) startParticles();
    enableTilt(document.querySelector(".scan-panel[data-tilt]"));
    if (window.matchMedia(MOBILE_MQ).matches) {
      setScanPanelCollapsed(true);
    }
    if (isCloudConfigured()) {
      flushCloudOutbox()
        .then(() => pullCloudRoster({ silent: true }))
        .then(() => startCloudSyncLoop())
        .catch(() => startCloudSyncLoop());
    }
    if (isAdmin) {
      startAdminRealtime({ claim: true });
    }
  }

  function bindEvents() {
    el.primaryBtn.addEventListener("click", () => {
      if (entryMode === "quick") saveCurrentMember();
      else nextStep();
    });
    el.backBtn.addEventListener("click", prevStep);
    el.resetBtn.addEventListener("click", () => resetForm(true));
    el.demoBtn.addEventListener("click", loadDemo);
    el.exportBtn.addEventListener("click", exportCSV);
    el.copyDiscordBtn?.addEventListener("click", copyDiscordReport);
    el.syncBtn?.addEventListener("click", openSyncModal);
    el.syncCloseBtn?.addEventListener("click", () => closeModal("sync"));
    el.syncPullBtn?.addEventListener("click", () => pullCloudRoster({ silent: false }));
    el.syncPushBtn?.addEventListener("click", () => pushCloudRosterWithRetry({ silent: false }));
    el.exportJsonBtn?.addEventListener("click", exportJsonRoster);
    el.importJsonInput?.addEventListener("change", importJsonRoster);
    el.guidedModeBtn?.addEventListener("click", () => setEntryMode("guided"));
    el.quickModeBtn?.addEventListener("click", () => setEntryMode("quick"));
    el.searchInput.addEventListener("input", scheduleRosterRender);
    el.levelFilter.addEventListener("change", renderRoster);
    el.rankFilter?.addEventListener("change", renderRoster);
    el.statusFilter.addEventListener("change", renderRoster);
    el.sortSelect.addEventListener("change", renderRoster);
    el.rallyCriteriaMode?.addEventListener("change", onRallyCriteriaModeChange);
    el.rallyMinApc1Input?.addEventListener("change", onRallyManualThresholdChange);
    el.rallyMinPlazaInput?.addEventListener("change", onRallyManualThresholdChange);
    el.sfxBtn.addEventListener("click", () => {
      unlockAudio();
      sfxEnabled = !sfxEnabled;
      el.sfxBtn.classList.toggle("active", sfxEnabled);
      playSfx("click");
    });
    el.adminAccessBtn.addEventListener("click", handleAdminAccess);
    el.adminLoginBtn.addEventListener("click", attemptAdminLogin);
    el.adminCancelBtn.addEventListener("click", () => closeModal("admin"));
    el.adminChatForm?.addEventListener("submit", onAdminChatSubmit);
    document.querySelectorAll("[data-modal-close]").forEach(node => {
      node.addEventListener("click", () => closeModal(node.dataset.modalClose));
    });
    el.deleteConfirmBtn.addEventListener("click", confirmDeleteMember);
    el.deleteCancelBtn.addEventListener("click", () => closeModal("delete"));
    el.scanToggleBtn?.addEventListener("click", toggleScanPanel);
    el.adminCodeInput.addEventListener("keydown", event => { if (event.key === "Enter") attemptAdminLogin(); });
    el.memberDrawerSave?.addEventListener("click", saveMemberDrawer);
    el.personalCodeCopyBtn?.addEventListener("click", copyRevealedPersonalCode);
    el.historyRefreshBtn?.addEventListener("click", () => {
      pullCloudRoster({ silent: false }).then(() => renderHistory());
    });
    document.querySelectorAll("[data-admin-view]").forEach(btn => {
      btn.addEventListener("click", () => setAdminView(btn.dataset.adminView));
    });
    document.querySelectorAll("[data-drawer-close]").forEach(node => {
      node.addEventListener("click", closeMemberDrawer);
    });
    document.addEventListener("click", onDynamicClick);
    document.addEventListener("input", onDynamicInput);
    document.addEventListener("click", closeUiSelectsOnOutsideClick);
    window.addEventListener("keydown", onGlobalKeydown);
  }

  function onGlobalKeydown(event) {
    if (event.key === "Escape") {
      closeAllUiSelects();
      if (el.memberDrawer?.classList.contains("open")) closeMemberDrawer();
      else if (el.personalCodeModal?.classList.contains("open")) closeModal("personalCode");
      else if (el.deleteModal.classList.contains("open")) closeModal("delete");
      else if (el.syncModal?.classList.contains("open")) closeModal("sync");
      else if (el.adminModal.classList.contains("open")) closeModal("admin");
      return;
    }
    if (document.body.classList.contains("modal-open")) return;
    if (event.key !== "Enter") return;

    const target = event.target;
    const tag = target.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A" || target.isContentEditable) return;
    if (document.querySelector(".ui-select.is-open")) return;
    if (tag !== "INPUT" && tag !== "SELECT") return;
    if (el.memberDrawer?.classList.contains("open")) return;

    event.preventDefault();
    if (entryMode === "quick") saveCurrentMember();
    else nextStep();
  }

  function initMobileTabs() {
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => {
      const isMobile = mq.matches;
      if (el.mobileShellTabs) el.mobileShellTabs.hidden = !isMobile;
      if (!isMobile) {
        document.body.classList.remove("mobile-tab-preview", "mobile-tab-push");
        return;
      }
      setMobileTab(mobileTab || "preview", { silent: true });
    };
    el.mobileShellTabs?.querySelectorAll("[data-mobile-tab]").forEach(btn => {
      btn.addEventListener("click", () => setMobileTab(btn.dataset.mobileTab));
    });
    apply();
    mq.addEventListener?.("change", apply);
  }

  function setMobileTab(tab, { silent = false } = {}) {
    mobileTab = tab === "push" ? "push" : "preview";
    document.body.classList.toggle("mobile-tab-preview", mobileTab === "preview");
    document.body.classList.toggle("mobile-tab-push", mobileTab === "push");
    el.mobileShellTabs?.querySelectorAll("[data-mobile-tab]").forEach(btn => {
      const active = btn.dataset.mobileTab === mobileTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    if (!silent) playSfx("click");
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

  function renderAll() {
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
    } else {
      clearAdminViews();
    }
    syncLiveRallyClassification({ skipScan: true });
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
        mountTimesEventsClock(api);
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

  function mountTimesEventsClock(api) {
    if (!el.teServerClock || !api?.mountServerClock) return;
    if (el.teServerClock.dataset.mounted === "1") return;
    try {
      api.mountServerClock({
        clockEl: el.teServerClock,
        serverBadgeEl: el.teServerBadge,
        localClockEl: el.teLocalClock,
        localOffsetBadgeEl: el.teLocalBadge,
        localZoneLabelEl: null,
        offsetSelect: el.teOffsetSelect,
        eventInput: el.teEventInput,
        resultEl: el.teConvertedTime,
        resultMetaEl: el.teConvertedMeta
      });
      el.teServerClock.dataset.mounted = "1";
      enhanceSelects(el.timesEventsPanel);
    } catch (error) {
      console.warn("Times/events clock failed:", error);
    }
  }

  function setEntryMode(mode) {
    entryMode = mode === "quick" ? "quick" : "guided";
    prefs.entryMode = entryMode;
    savePrefs();
    applyEntryMode();
    wizardRailDirty = true;
    renderWizard(true);
    renderScan();
    playSfx("click");
  }

  function applyEntryMode() {
    const quick = entryMode === "quick";
    document.body.classList.toggle("quick-entry", quick);
    el.guidedModeBtn?.classList.toggle("active", !quick);
    el.quickModeBtn?.classList.toggle("active", quick);
    if (el.entryTitle) el.entryTitle.textContent = quick ? "Quick APC submit" : "Guided APC setup";
    if (el.entrySubtitle) {
      el.entrySubtitle.textContent = quick
        ? "One screen for Dark War Survival Garage APC CP. Paste chat lines or fill fields and submit."
        : "Register one PH-L member at a time. Only the field you need is shown.";
    }
    if (el.wizardCardHead) el.wizardCardHead.hidden = quick;
    if (el.wizardRail) el.wizardRail.hidden = quick;
    if (el.stepPill) el.stepPill.hidden = quick;
    if (el.backBtn) {
      el.backBtn.hidden = quick;
      if (!quick) {
        el.backBtn.disabled = currentStep === 0;
        el.backBtn.style.opacity = currentStep === 0 ? ".55" : "1";
      }
    }
  }

  function renderWizard(forceRail = false) {
    if (entryMode === "quick") {
      renderQuickSubmit();
      enhanceSelects(el.wizardContent);
      updateWizardMeta();
      return;
    }

    const meta = stepMeta[currentStep];
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

    if (meta.key === "identity") renderIdentityStep();
    else if (meta.key.startsWith("apc")) renderApcStep(Number(meta.key.slice(3)) - 1);
    else renderReviewStep();
    enhanceSelects(el.wizardContent);
  }

  function updateWizardMeta(meta = stepMeta[currentStep]) {
    if (entryMode === "quick") {
      el.primaryBtn.textContent = editingId
        ? (isAdmin ? "Update roster" : "Update submission")
        : (isAdmin ? "Save to roster" : "Submit APC CP");
      el.backBtn.disabled = true;
      el.backBtn.style.opacity = ".55";
      return;
    }

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
          <label for="personalCodeInput">Personal Code (optional — overwrite)</label>
          <input class="input" id="personalCodeInput" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="e.g. PHL-AB12CD" value="${escapeHtml(state.personalCode)}">
          <small>${remembered ? `Last code on this device: <strong>${escapeHtml(remembered)}</strong>. ` : ""}Enter your code to overwrite your roster entry. Leave blank to register (or create a <code>[name]-updt</code> review entry).</small>
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
          <div class="summary-stack">
            <div class="summary-line"><span>Name entered</span><b data-checklist="name">${state.name.trim() ? "Yes" : "No"}</b></div>
            <div class="summary-line"><span>Level selected</span><b data-checklist="level">${formatLevel(state.level)}</b></div>
            <div class="summary-line"><span>Rank selected</span><b data-checklist="rank">${state.rank}</b></div>
            <div class="summary-line"><span>Plaza capacity</span><b data-checklist="plaza">${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
            <div class="summary-line"><span>Rally role</span><b data-checklist="role" data-live-rally-role class="${role.assigned_role === "RL" ? "gap-met" : "gap-short"}">${role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner"}</b></div>
            <div class="summary-line"><span>Role gate</span><b data-live-rally-reason>${escapeHtml(getRallyGateReasonFromState())}</b></div>
            <div class="summary-line"><span>Main gap</span><b data-checklist="gap">${formatGap(getFrontlineGap(state.level, state.apcs[0].cp))}</b></div>
          </div>
        </div>
      </div>`;
  }

  function renderQuickSubmit() {
    const band = BANDS[state.level];
    const mainGap = getFrontlineGap(state.level, state.apcs[0].cp);
    const role = classifyCurrentState();
    el.wizardContent.innerHTML = `
      <div class="quick-submit">
        <label class="field paste-field">
          <span>Paste from chat / Garage notes</span>
          <textarea class="input paste-input" id="pasteInput" rows="2" placeholder="Example: PlayerOne i5 820/760/710/655 450000"></textarea>
          <button class="btn btn-ghost paste-apply" type="button" id="pasteApplyBtn">Parse paste</button>
        </label>
        <div class="field-grid">
          <div class="field"><label for="memberNameInput">Player name</label><input class="input" id="memberNameInput" type="text" maxlength="30" autocomplete="nickname" placeholder="Example: PlayerOne" value="${escapeHtml(state.name)}"></div>
          <div class="field"><label for="memberLevelInput">Watchtower</label><select id="memberLevelInput">${levelOptionsHtml(state.level)}</select></div>
          <div class="field"><label for="memberRankInput">PH-L rank</label><select id="memberRankInput">${rankOptionsHtml(state.rank)}</select></div>
          <div class="field"><label for="rallyCapacityInput">Rally Plaza capacity</label><input class="input" id="rallyCapacityInput" type="number" min="0" step="1000" inputmode="numeric" placeholder="Troops, e.g. 400000" value="${state.rallyCapacity || ""}"></div>
          <div class="field personal-code-field" style="grid-column:1/-1">
            <label for="personalCodeInput">Personal Code (optional — overwrite)</label>
            <input class="input" id="personalCodeInput" type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="e.g. PHL-AB12CD" value="${escapeHtml(state.personalCode)}">
            <small>Enter your code to overwrite. Leave blank to register or create a <code>[name]-updt</code> review entry.</small>
          </div>
        </div>
        <div class="quick-apc-grid">
          ${state.apcs.map((apc, index) => {
            const gap = index === 0 ? getFrontlineGap(state.level, apc.cp) : null;
            return `
              <div class="quick-apc-card">
                <div class="quick-apc-head">
                  <strong>APC ${index + 1}${index === 0 ? " · Main" : ""}</strong>
                  ${gap ? `<span class="gap-chip ${gap.met ? "met" : "short"}">${formatGap(gap)}</span>` : `<span class="gap-chip">${apc.faction}</span>`}
                </div>
                <div class="faction-row compact">
                  ${FACTIONS.map(f => `<button class="seg-btn ${apc.faction === f ? "active" : ""}" type="button" data-apc-index="${index}" data-faction="${f}">${f}</button>`).join("")}
                </div>
                <div class="value-wrap">
                  <input class="cp-input" id="cpInput${index}" data-apc-index="${index}" type="number" min="0" max="${getMaxForLevel(state.level)}" step="1" value="${apc.cp}" aria-label="APC ${index + 1} CP">
                  <b>M CP</b>
                </div>
              </div>`;
          }).join("")}
        </div>
        <div class="helper-grid">
          <div class="helper-card">
            <span>PH-L benchmarks · ${formatLevel(state.level)}</span>
            <div class="benchmark-values">
              <div class="benchmark-card"><strong>${band.operational}M</strong><small>Operational</small></div>
              <div class="benchmark-card"><strong>${band.frontline}M</strong><small>Frontline</small></div>
              <div class="benchmark-card"><strong>${band.apex}M</strong><small>Apex</small></div>
            </div>
          </div>
          <div class="helper-card">
            <span>Main APC readiness</span>
            <div class="summary-stack">
              <div class="summary-line"><span>Status</span><b>${getBandLabel(state.level, state.apcs[0].cp)}</b></div>
              <div class="summary-line"><span>Frontline target</span><b>${band.frontline}M</b></div>
              <div class="summary-line"><span>Gap</span><b data-quick-main-gap class="${mainGap.met ? "gap-met" : "gap-short"}">${formatGap(mainGap)}</b></div>
              <div class="summary-line"><span>Plaza</span><b data-live-plaza>${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
              <div class="summary-line"><span>Rally role</span><b data-live-rally-role class="${role.assigned_role === "RL" ? "gap-met" : "gap-short"}">${role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner"}</b></div>
              <div class="summary-line"><span>Role gate</span><b data-live-rally-reason>${escapeHtml(getRallyGateReasonFromState())}</b></div>
              <div class="summary-line"><span>Total APC CP</span><b>${formatNumber(getTotalFromState())}M</b></div>
            </div>
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
    el.wizardContent.innerHTML = `
      <div class="apc-focus">
        <div class="apc-preview" data-tilt>
          <div class="mini-grid"></div>
          <div class="floating-id">APC ${index + 1}</div>
          <img class="game-asset" src="${ASSETS.apc}" alt="APC ${index + 1} preview" width="240" height="180" decoding="async">
        </div>
        <div class="apc-editor">
          <div class="field"><span>Faction focus</span></div>
          <div class="faction-row">
            ${FACTIONS.map(f => `<button class="seg-btn ${apc.faction === f ? "active" : ""}" type="button" data-apc-index="${index}" data-faction="${f}">${f}</button>`).join("")}
          </div>
          <div class="cp-control">
            <button class="mini-btn" type="button" data-apc-index="${index}" data-step="-10">-10</button>
            <div class="value-wrap">
              <input class="cp-input" id="cpInput${index}" data-apc-index="${index}" type="number" min="0" max="${max}" step="1" value="${apc.cp}">
              <b>M CP</b>
            </div>
            <button class="mini-btn" type="button" data-apc-index="${index}" data-step="10">+10</button>
          </div>
          <input class="slider" id="slider${index}" data-apc-index="${index}" type="range" min="0" max="${max}" step="1" value="${apc.cp}" aria-label="APC ${index + 1} combat power">
          <div class="preset-row">
            ${PRESETS.map(value => `<button class="preset${value > max ? " is-disabled" : ""}${apc.cp === value ? " is-active" : ""}" type="button" data-apc-index="${index}" data-preset="${value}" ${value > max ? "disabled" : ""}>${value}M</button>`).join("")}
            <button class="preset" type="button" data-apc-index="${index}" data-preset="${band.frontline}">Frontline ${band.frontline}M</button>
            <button class="preset" type="button" data-apc-index="${index}" data-preset="${band.apex}">Apex ${band.apex}M</button>
          </div>
          ${index === 0 ? `
          <div class="plaza-block">
            <div class="field">
              <label for="rallyCapacityInput">Rally Plaza capacity (troops)</label>
              <input class="input" id="rallyCapacityInput" type="number" min="0" step="1000" inputmode="numeric" placeholder="Example: 400000" value="${state.rallyCapacity || ""}">
            </div>
            <div class="plaza-live">
              <div class="summary-line"><span>Plaza entered</span><b data-checklist="plaza">${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
              <div class="summary-line"><span>Rally role</span><b data-live-rally-role class="${role.assigned_role === "RL" ? "gap-met" : "gap-short"}">${role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner"}</b></div>
              <div class="summary-line"><span>Role gate</span><b data-live-rally-reason>${escapeHtml(getRallyGateReasonFromState())}</b></div>
            </div>
          </div>` : ""}
          <div class="apc-footer">
            <div class="apc-stat"><span>Suggested cap</span><strong data-apc-stat="cap">${max}M</strong></div>
            <div class="apc-stat"><span>Status band</span><strong data-apc-stat="band">${getBandLabel(state.level, apc.cp)}</strong></div>
            <div class="apc-stat"><span>Gap to frontline</span><strong data-apc-stat="gap" class="${gap.met ? "gap-met" : "gap-short"}">${formatGap(gap)}</strong></div>
          </div>
        </div>
      </div>`;
    enableTilt(el.wizardContent.querySelector("[data-tilt]"));
  }

  function renderReviewStep() {
    const band = BANDS[state.level];
    const total = getTotalFromState();
    const average = total / APC_COUNT;
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
            <div class="summary-line"><span>Personal Code</span><b>${state.personalCode ? escapeHtml(state.personalCode) : "Will assign / review"}</b></div>
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
              return `<div class="summary-line apc-review-line">
                <span>APC ${i + 1} · ${apc.faction}</span>
                <b class="apc-review-values">
                  <em class="apc-cp">${formatNumber(apc.cp)}M <small>entered</small></em>
                  ${gap ? `<em class="apc-gap ${gap.met ? "gap-met" : "gap-short"}">${formatGap(gap)} <small>vs frontline</small></em>` : ""}
                </b>
              </div>`;
            }).join("")}
            <div class="summary-line"><span>Total APC CP</span><b>${formatNumber(total)}M</b></div>
            <div class="summary-line"><span>Average APC</span><b>${formatNumber(average)}M</b></div>
            <div class="summary-line"><span>Plaza</span><b data-live-plaza>${state.rallyCapacity ? formatTroops(state.rallyCapacity) : "—"}</b></div>
            <div class="summary-line"><span>Rally role</span><b data-live-rally-role class="${role.assigned_role === "RL" ? "gap-met" : "gap-short"}">${role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner"}</b></div>
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
    const max = getMaxForLevel(state.level);

    if (target.classList.contains("cp-input")) {
      state.apcs[idx].cp = clamp(Number(target.value || 0), 0, max);
      const slider = document.getElementById(`slider${idx}`);
      if (slider) slider.value = String(state.apcs[idx].cp);
    }

    if (target.classList.contains("slider")) {
      state.apcs[idx].cp = Number(target.value);
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
        return;
      }
      const idx = Number(factionBtn.dataset.apcIndex);
      state.apcs[idx].faction = factionBtn.dataset.faction;
      el.wizardContent.querySelectorAll(`[data-faction][data-apc-index="${idx}"]`).forEach(node => {
        node.classList.toggle("active", node.dataset.faction === state.apcs[idx].faction);
      });
      const factionStat = el.wizardContent.querySelector('[data-apc-stat="faction"]');
      if (factionStat) factionStat.textContent = state.apcs[idx].faction;
      if (entryMode === "quick" && idx > 0) {
        const chips = el.wizardContent.querySelectorAll(".gap-chip");
        if (chips[idx]) chips[idx].textContent = state.apcs[idx].faction;
      }
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
    if (action?.dataset.action === "edit") {
      openMemberDrawer(action.dataset.id);
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
    if (emptyAction?.dataset.emptyAction === "demo") {
      if (!isAdmin) {
        openAdminModal();
        toast("Demo roster is admin-only.", "error");
        playSfx("error");
        return;
      }
      loadDemo();
      return;
    }

    if (event.target.id === "pasteApplyBtn" || event.target.closest("#pasteApplyBtn")) {
      applyPasteInput();
    }
  }

  function applyApcDelta(index, delta) {
    const max = getMaxForLevel(state.level);
    state.apcs[index].cp = clamp(state.apcs[index].cp + delta, 0, max);
    syncApcControls(index);
    updateApcLiveStats(index);
    syncLiveRallyClassification();
    if (isAdmin) renderSummaryStrip();
    playSfx("click");
  }

  function applyApcValue(index, value) {
    state.apcs[index].cp = clamp(value, 0, getMaxForLevel(state.level));
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

    if (entryMode === "quick") {
      const chips = el.wizardContent.querySelectorAll(".gap-chip");
      if (index === 0 && chips[0]) {
        chips[0].textContent = formatGap(gap);
        chips[0].classList.toggle("met", gap.met);
        chips[0].classList.toggle("short", !gap.met);
      } else if (chips[index]) {
        chips[index].textContent = apc.faction;
      }
      const mainGap = el.wizardContent.querySelector("[data-quick-main-gap]");
      if (mainGap && index === 0) {
        mainGap.textContent = formatGap(gap);
        mainGap.classList.toggle("gap-met", gap.met);
        mainGap.classList.toggle("gap-short", !gap.met);
      }
    }
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
    const max = getMaxForLevel(state.level);
    state.apcs.forEach(apc => {
      apc.cp = clamp(apc.cp, 0, max);
    });
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

  function makeUpdateReviewName(baseName) {
    const clean = String(baseName || "member").trim().replace(/\[|\]/g, "").replace(/-updt\d*$/i, "").slice(0, 18);
    const tagged = `[${clean}]-updt`;
    return tagged.slice(0, 30);
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
    if (!state.apcs.some(apc => apc.cp > 0)) {
      toast("Add at least one APC power value.", "error");
      playSfx("error");
      return;
    }
    if (!Number(state.rallyCapacity) && !window.confirm(
      "Rally Plaza capacity is empty. Save anyway? RL/RJ classification needs Plaza troops with APC1."
    )) {
      document.getElementById("rallyCapacityInput")?.focus();
      return;
    }

    const enteredCode = normalizePersonalCode(state.personalCode);
    const codeMatch = enteredCode ? findMemberByPersonalCode(enteredCode) : null;
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
      apcs: state.apcs.map(apc => ({ ...apc }))
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
    renderAll();
    setSavingUi(true);

    try {
      // Pull latest shared roster, then push so every device sees this submit
      await pullCloudRoster({ silent: true });
      member = upsertMember(member);
      saveRoster();
      const synced = await pushCloudRosterWithRetry({ silent: true });
      if (synced) {
        clearCloudOutboxMember(member.id);
        if (revealCode || actionLabel === "claim-legacy" || actionLabel === "needs-review") {
          pendingPersonalCodeReveal = member.personalCode;
          openPersonalCodeModal(member.personalCode);
        }
        const reviewNote = needsReview ? " Flagged for admin review." : "";
        toast(
          actionLabel === "code-overwrite" || actionLabel === "admin-update" || actionLabel === "claim-legacy"
            ? `<strong>${escapeHtml(member.name)}</strong> updated in the shared cloud roster.${reviewNote}`
            : `<strong>${escapeHtml(member.name)}</strong> saved to the shared cloud roster.${reviewNote}`,
          "success"
        );
        playSfx("success");
      } else {
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
    state.apcs = Array.from({ length: APC_COUNT }, () => ({ cp: 0, faction: "Fighter" }));
    renderAll();
    if (play) playSfx("click");
  }

  function editMember(id) {
    // Admin interactive edit uses the drawer; keep wizard path only as fallback.
    openMemberDrawer(id);
  }

  function openMemberDrawer(id) {
    if (!isAdmin) {
      openAdminModal();
      return;
    }
    const member = roster.find(item => item.id === id);
    if (!member || !el.memberDrawer || !el.memberDrawerBody) return;

    drawerMemberId = member.id;
    lastFocusedElement = document.activeElement;
    if (el.memberDrawerTitle) el.memberDrawerTitle.textContent = member.name;
    if (el.memberDrawerSub) {
      el.memberDrawerSub.textContent = member.personalCode
        ? `Personal Code ${member.personalCode} · tap fields to edit`
        : "No Personal Code yet · save to assign one";
    }

    el.memberDrawerBody.innerHTML = `
      <div class="field"><label for="drawerName">Player name</label><input class="input" id="drawerName" maxlength="30" value="${escapeHtml(member.name)}"></div>
      <div class="field"><label for="drawerLevel">Level</label><select id="drawerLevel">${levelOptionsHtml(member.level)}</select></div>
      <div class="field"><label for="drawerRank">PH-L rank</label><select id="drawerRank">${rankOptionsHtml(member.rank)}</select></div>
      <div class="field"><label for="drawerPlaza">Rally Plaza capacity</label><input class="input" id="drawerPlaza" type="number" min="0" step="1000" value="${member.rallyCapacity || 0}"></div>
      <div class="field personal-code-field"><label for="drawerCode">Personal Code</label><input class="input" id="drawerCode" maxlength="16" value="${escapeHtml(member.personalCode || "")}"><small>Admins can set or rotate codes. Leave blank to keep / auto-assign on save.</small></div>
      <label class="field" style="display:flex;align-items:center;gap:10px;flex-direction:row">
        <input type="checkbox" id="drawerNeedsReview" ${memberNeedsReview(member) ? "checked" : ""}>
        <span>Needs review (-updt)</span>
      </label>
      <div class="drawer-apc-grid">
        ${Array.from({ length: APC_COUNT }, (_, i) => {
          const apc = member.apcs?.[i] || { cp: 0, faction: "Fighter" };
          return `
            <div class="drawer-apc-card">
              <strong>APC ${i + 1}${i === 0 ? " · Main" : ""}</strong>
              <div class="faction-row compact">
                ${FACTIONS.map(f => `<button class="seg-btn ${apc.faction === f ? "active" : ""}" type="button" data-drawer-faction="${i}" data-faction="${f}">${f}</button>`).join("")}
              </div>
              <div class="value-wrap">
                <input class="cp-input input" id="drawerCp${i}" type="number" min="0" step="1" value="${Number(apc.cp || 0)}" aria-label="APC ${i + 1} CP">
                <b>M CP</b>
              </div>
            </div>`;
        }).join("")}
      </div>`;

    enhanceSelects(el.memberDrawerBody);
    el.memberDrawer.classList.add("open");
    el.memberDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    document.getElementById("drawerName")?.focus();
    playSfx("transition");
  }

  function closeMemberDrawer() {
    if (!el.memberDrawer) return;
    el.memberDrawer.classList.remove("open");
    el.memberDrawer.setAttribute("aria-hidden", "true");
    drawerMemberId = null;
    if (!el.adminModal?.classList.contains("open") && !el.deleteModal?.classList.contains("open") && !el.syncModal?.classList.contains("open") && !el.personalCodeModal?.classList.contains("open")) {
      document.body.classList.remove("modal-open");
    }
    if (lastFocusedElement?.focus) lastFocusedElement.focus();
  }

  async function saveMemberDrawer() {
    if (!isAdmin || !drawerMemberId) return;
    const previous = roster.find(m => m.id === drawerMemberId);
    if (!previous) {
      closeMemberDrawer();
      return;
    }

    const name = String(document.getElementById("drawerName")?.value || "").trim().slice(0, 30);
    const level = document.getElementById("drawerLevel")?.value;
    const rank = document.getElementById("drawerRank")?.value;
    const plaza = Math.max(0, Math.floor(Number(document.getElementById("drawerPlaza")?.value || 0)));
    let code = normalizePersonalCode(document.getElementById("drawerCode")?.value || "");
    const needsReview = Boolean(document.getElementById("drawerNeedsReview")?.checked);
    if (!name) {
      toast("Name is required.", "error");
      playSfx("error");
      return;
    }
    if (!BANDS[level] || !RANKS.includes(rank)) {
      toast("Invalid level or rank.", "error");
      playSfx("error");
      return;
    }
    if (!code) code = previous.personalCode || generatePersonalCode();
    const codeOwner = findMemberByPersonalCode(code);
    if (codeOwner && codeOwner.id !== previous.id) {
      toast("That Personal Code belongs to another member.", "error");
      playSfx("error");
      return;
    }

    const max = getMaxForLevel(level);
    const apcs = Array.from({ length: APC_COUNT }, (_, i) => {
      const factionBtn = el.memberDrawerBody.querySelector(`[data-drawer-faction="${i}"].active`);
      const cp = clamp(Number(document.getElementById(`drawerCp${i}`)?.value || 0), 0, max);
      return {
        cp,
        faction: factionBtn?.dataset.faction || previous.apcs?.[i]?.faction || "Fighter"
      };
    });

    const member = {
      ...previous,
      name,
      level,
      rank,
      rallyCapacity: plaza,
      personalCode: code,
      needsReview,
      updated: Date.now(),
      apcs
    };

    const fields = diffMemberFields(previous, member);
    const idx = roster.findIndex(m => m.id === member.id);
    if (idx >= 0) roster[idx] = member;
    saveRoster();
    appendHistoryEvent({
      action: "admin-drawer",
      memberId: member.id,
      memberName: member.name,
      actor: adminSession?.name || "admin",
      fields,
      note: "Edited via member drawer"
    });
    queueCloudOutbox(member);
    closeMemberDrawer();
    renderAll();
    const ok = await pushCloudRosterWithRetry({ silent: true });
    toast(
      ok
        ? `<strong>${escapeHtml(member.name)}</strong> updated.`
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
    animateKpi(el.scanAverage, total / APC_COUNT, { suffix: "M", duration: 360 });
    const gap = getFrontlineGap(state.level, main);
    if (el.scanGap) {
      el.scanGap.textContent = formatGap(gap);
      el.scanGap.classList.toggle("gap-met", gap.met);
      el.scanGap.classList.toggle("gap-short", !gap.met && main > 0);
    }
    const role = classifyCurrentState();
    if (el.scanRallyRole) {
      el.scanRallyRole.textContent = role.assigned_role;
      el.scanRallyRole.classList.toggle("role-rl", role.assigned_role === "RL");
      el.scanRallyRole.classList.toggle("role-rj", role.assigned_role === "RJ");
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
      filtered = filtered.filter(member => getMemberRallyRole(member).assigned_role === statusFilter.toUpperCase());
    } else if (statusFilter !== "all") {
      filtered = filtered.filter(member => getStatusKey(member.level, getMain(member)) === statusFilter);
    }

    filtered = [...filtered].sort((a, b) => sortMembers(a, b, sort));
    el.resultText.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"} shown`;

    if (!filtered.length) {
      el.rosterList.innerHTML = `
        <div class="empty">
          <strong>No roster signals found</strong>
          <p>Create a member with the guided flow, or load the admin demo (KittyKlawzz · Fisherman5).</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-empty-action="start">Start guided entry</button>
            ${isAdmin ? `<button class="btn btn-ghost" data-empty-action="demo">Load demo data</button>` : ""}
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
        <article class="member-card${review ? " is-needs-review" : ""}" style="--status:${st.color}">
          <div>
            <div class="member-tags">
              <span class="tag level">${formatLevel(member.level)}</span>
              <span class="tag">${member.rank}</span>
              <span class="tag status">${st.label}</span>
              <span class="tag ${rally.assigned_role === "RL" ? "role-rl" : "role-rj"}">${rally.assigned_role}</span>
              <span class="tag">${rally.specialty_faction}</span>
              <span class="tag ${gap.met ? "gap-ok" : "gap-bad"}">${formatGap(gap)}</span>
              ${stale ? '<span class="tag stale">Stale</span>' : ""}
              ${review ? '<span class="tag needs-review">Needs review</span>' : ""}
              ${member.personalCode ? `<span class="tag personal-code" title="Personal Code">${escapeHtml(member.personalCode)}</span>` : ""}
            </div>
            <div class="member-name">${escapeHtml(member.name)}</div>
            <div class="member-sub">${escapeHtml(getRallyGateReason(member))} · Plaza ${formatTroops(member.rallyCapacity || 0)} · Updated ${timeAgo(member.updated)}</div>
          </div>
          <div class="apc-bars">
            ${member.apcs.map((apc, i) => `
              <div class="apc-row">
                <b>A${i + 1}</b>
                <span class="faction ${apc.faction.toLowerCase()}">${apc.faction}</span>
                <div class="bar"><div class="fill" style="--w:${Math.min(100, (apc.cp / Math.max(getMaxForLevel(member.level), 1)) * 100).toFixed(1)}%"></div></div>
                <div class="row-val">${formatNumber(apc.cp)}<small>M</small></div>
              </div>`).join("")}
          </div>
          <div class="score-box"><span>Total APC CP</span><strong>${formatNumber(total)}<small>M</small></strong></div>
          <div class="card-actions">
            <button class="card-action edit-primary" type="button" data-action="edit" data-id="${member.id}" title="Edit in drawer">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25Zm18-11.5a1 1 0 0 0 0-1.41l-1.34-1.34a1 1 0 0 0-1.41 0l-1.05 1.05 3.75 3.75L21 5.75Z"/></svg>
              Edit
            </button>
            ${member.personalCode ? `<button class="card-action" type="button" data-action="copy-code" data-code="${escapeHtml(member.personalCode)}" title="Copy Personal Code">Code</button>` : ""}
            ${review ? `<button class="card-action" type="button" data-action="clear-review" data-id="${member.id}" title="Mark reviewed">OK</button>` : ""}
            <button class="card-action delete" type="button" data-action="delete" data-id="${member.id}" title="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>
            </button>
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
          <div class="rank-sub">${formatLevel(member.level)} · ${member.rank} · ${getMemberRallyRole(member).assigned_role} · ${formatGap(getFrontlineGap(member.level, getMain(member)))}</div>
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
    const saved = roster.map(getMemberRallyRole);
    const summary = {
      rl: saved.filter(m => m.assigned_role === "RL").length,
      rj: saved.filter(m => m.assigned_role === "RJ").length
    };
    animateKpi(el.kpiRl, summary.rl, { decimals: 0, duration: 420 });
    animateKpi(el.kpiRj, summary.rj, { decimals: 0, duration: 420 });

    const leaders = saved.filter(m => m.assigned_role === "RL");
    if (el.rallyLeaderList) {
      if (!thresholds.ready) {
        el.rallyLeaderList.hidden = true;
        el.rallyLeaderList.innerHTML = "";
      } else if (leaders.length) {
        el.rallyLeaderList.hidden = false;
        el.rallyLeaderList.innerHTML = leaders.map(m => {
          const raw = roster.find(r => r.id === m.id);
          return `<div class="rally-leader-row"><b>${escapeHtml(m.name)}</b><span>${m.specialty_faction} · Plaza ${formatTroops(raw?.rallyCapacity || 0)}</span></div>`;
        }).join("");
      } else {
        el.rallyLeaderList.hidden = false;
        el.rallyLeaderList.innerHTML = `<div class="rally-leader-empty">No Rally Leaders above ${formatThresholdSummary(thresholds)}.</div>`;
      }
    }

    renderRallyFormations(saved, thresholds);

    if (el.rallyRuleCopy) {
      const draft = hasDraftRallySignal() ? classifyCurrentState() : null;
      const draftNote = draft && thresholds.ready ? ` · Form: ${draft.assigned_role}` : "";
      el.rallyRuleCopy.textContent = `${thresholds.label}${draftNote}`;
    }
  }

  function renderRallyFormations(categorized, thresholds) {
    if (!el.rallyFormationList) return;
    const block = el.rallyMatchmaking || document.getElementById("rallyMatchmaking");
    if (block) block.hidden = false;

    if (!thresholds?.ready) {
      el.rallyFormationList.innerHTML = `
        <div class="rally-leader-empty">
          Strike teams need real uploads first. As members submit APC1 CP, live median gates appear and RL/RJ updates automatically.
        </div>`;
      return;
    }

    const api = globalThis.PHL_RALLY_MATCHMAKING || globalThis.PHL_RALLY_ROLES;
    if (!api?.suggestRallyFormations) {
      el.rallyFormationList.innerHTML = `<div class="rally-leader-empty">Matchmaking module not loaded. Hard-refresh (v25).</div>`;
      return;
    }

    const leaders = categorized.filter(m => m.assigned_role === "RL");
    const joiners = categorized.filter(m => m.assigned_role === "RJ");
    if (!leaders.length) {
      el.rallyFormationList.innerHTML = `<div class="rally-leader-empty">No Rally Leaders yet — raise Plaza / APC1 above the gates, or lower manual thresholds.</div>`;
      return;
    }
    if (!joiners.length) {
      el.rallyFormationList.innerHTML = `<div class="rally-leader-empty">Need at least one Rally Joiner (below the gates) to fill marches (~100k each).</div>`;
      return;
    }

    const groups = api.suggestRallyFormations(categorized);
    if (!groups.length) {
      el.rallyFormationList.innerHTML = `<div class="rally-leader-empty">No formations generated.</div>`;
      return;
    }

    el.rallyFormationList.innerHTML = groups.map(group => {
      const pure = group.is_faction_pure;
      const troops = formatTroops(group.expected_total_troops);
      const cap = formatTroops(group.max_capacity);
      const slots = Math.floor(Number(group.max_capacity || 0) / 100_000);
      let joinersHtml;
      if (group.recommended_joiners.length) {
        joinersHtml = group.recommended_joiners.map(name => {
          const off = (group.off_faction_fillers || []).includes(name);
          return `<li class="${off ? "is-off-faction" : "is-aligned"}">${escapeHtml(name)}${off ? " · off" : ""}</li>`;
        }).join("");
      } else if (slots <= 0) {
        joinersHtml = `<li class="is-empty">Plaza &lt; 100k — no joiner marches fit</li>`;
      } else {
        joinersHtml = `<li class="is-empty">No free joiners left in pool (${slots} open slot${slots === 1 ? "" : "s"})</li>`;
      }

      return `
        <article class="rally-formation-card ${pure ? "is-pure" : "is-mixed"}">
          <header>
            <div>
              <b>${escapeHtml(group.leader_name)}</b>
              <span>${escapeHtml(group.leader_faction)} RL · Plaza ${cap}</span>
            </div>
            <em class="rally-pure-tag">${pure ? "Pure" : "Mixed"}</em>
          </header>
          <ul class="rally-joiner-chips">${joinersHtml}</ul>
          <footer>
            <span>${troops} / ${cap}</span>
            <span>${group.recommended_joiners.length} march${group.recommended_joiners.length === 1 ? "" : "es"}${group.open_slots ? ` · ${group.open_slots} open` : ""}</span>
          </footer>
        </article>`;
    }).join("");
  }

  function syncRallyCriteriaControls() {
    const criteria = getRallyCriteriaPrefs();
    const rosterMode = criteria.mode !== "manual";
    if (el.rallyCriteriaMode) {
      el.rallyCriteriaMode.disabled = false;
      el.rallyCriteriaMode.value = criteria.mode;
    }
    if (el.rallyManualFields) el.rallyManualFields.hidden = rosterMode;
    if (el.rallyRosterReadout) el.rallyRosterReadout.hidden = !rosterMode;

    const live = getAllianceRallyThresholdsFromRoster();
    if (el.rallyReadoutApc) {
      el.rallyReadoutApc.textContent = live.ready
        ? `${formatNumber(live.minApc1M)}M`
        : "—";
    }
    if (el.rallyReadoutPlaza) {
      el.rallyReadoutPlaza.textContent = live.minPlaza > 0
        ? formatTroops(live.minPlaza)
        : (live.samplePlaza ? "—" : "pending");
    }

    if (el.rallyMinApc1Input && document.activeElement !== el.rallyMinApc1Input) {
      el.rallyMinApc1Input.value = criteria.minApc1M ? String(criteria.minApc1M) : "";
    }
    if (el.rallyMinPlazaInput && document.activeElement !== el.rallyMinPlazaInput) {
      el.rallyMinPlazaInput.value = criteria.minPlaza ? String(criteria.minPlaza) : "";
    }
  }

  function onRallyCriteriaModeChange() {
    const criteria = getRallyCriteriaPrefs();
    criteria.mode = el.rallyCriteriaMode?.value === "manual" ? "manual" : "roster";
    if (criteria.mode === "manual") {
      const live = getAllianceRallyThresholdsFromRoster();
      if (!criteria.minApc1M && live.minApc1M) criteria.minApc1M = Number(live.minApc1M) || 0;
      if (!criteria.minPlaza && live.minPlaza) criteria.minPlaza = Number(live.minPlaza) || 0;
    }
    prefs.rallyCriteria = criteria;
    savePrefs();
    syncRallyCriteriaControls();
    renderRoster();
    renderRallySplit();
    syncLiveRallyClassification({ skipScan: true });
    playSfx("click");
  }

  function onRallyManualThresholdChange() {
    const criteria = getRallyCriteriaPrefs();
    criteria.mode = "manual";
    criteria.minApc1M = Math.max(0, Number(el.rallyMinApc1Input?.value || 0));
    criteria.minPlaza = Math.max(0, Math.floor(Number(el.rallyMinPlazaInput?.value || 0)));
    prefs.rallyCriteria = criteria;
    savePrefs();
    if (el.rallyCriteriaMode) el.rallyCriteriaMode.value = "manual";
    syncRallyCriteriaControls();
    renderRoster();
    renderRallySplit();
    syncLiveRallyClassification({ skipScan: true });
  }

  function getRallyCriteriaPrefs() {
    const raw = prefs.rallyCriteria && typeof prefs.rallyCriteria === "object" ? prefs.rallyCriteria : {};
    return {
      mode: raw.mode === "manual" ? "manual" : "roster",
      minApc1M: Math.max(0, Number(raw.minApc1M) || 0),
      minPlaza: Math.max(0, Number(raw.minPlaza) || 0)
    };
  }

  /** Selected target: live roster median, or admin-selected custom APC1 + Plaza. */
  function getAllianceRallyThresholds() {
    const criteria = getRallyCriteriaPrefs();
    if (criteria.mode === "manual") {
      const minApc1M = Number(criteria.minApc1M) || 0;
      const minPlaza = Number(criteria.minPlaza) || 0;
      const ready = minApc1M > 0;
      return {
        ready,
        source: "manual",
        minApc1M,
        minPlaza,
        minApc1Cp: toAbsoluteCp(minApc1M),
        minRallyCapacity: minPlaza,
        label: ready
          ? `Selected target: APC1 ≥ ${formatNumber(minApc1M)}M${minPlaza > 0 ? ` · Plaza ≥ ${formatTroops(minPlaza)}` : " · Plaza optional"}`
          : "Select a custom APC1 target (M) to classify RL / RJ."
      };
    }
    return getAllianceRallyThresholdsFromRoster();
  }

  function getAllianceRallyThresholdsFromRoster() {
    const samples = roster
      .filter(member => !member.isDemo)
      .map(member => ({
        apc1_cp: toAbsoluteCp(getMain(member)),
        rally_capacity: Number(member.rallyCapacity || 0)
      }));
    const derived = window.PHL_RALLY_ROLES?.deriveThresholdsFromRoster
      ? window.PHL_RALLY_ROLES.deriveThresholdsFromRoster(samples)
      : { minApc1Cp: 0, minRallyCapacity: 0, sampleApc: 0, samplePlaza: 0 };

    const minApc1M = derived.minApc1Cp >= 10_000 ? derived.minApc1Cp / 1_000_000 : derived.minApc1Cp;
    const hasPlazaGate = derived.samplePlaza >= MIN_RALLY_ROSTER_SAMPLES && derived.minRallyCapacity > 0;
    const minPlaza = hasPlazaGate ? derived.minRallyCapacity : 0;
    const ready = derived.sampleApc >= MIN_RALLY_ROSTER_SAMPLES && minApc1M > 0;

    return {
      ready,
      source: "roster",
      minApc1M,
      minPlaza,
      minApc1Cp: derived.minApc1Cp,
      minRallyCapacity: minPlaza,
      sampleApc: derived.sampleApc,
      samplePlaza: derived.samplePlaza,
      label: !ready
        ? "Waiting for real uploads (APC1 CP) to classify RL / RJ."
        : hasPlazaGate
          ? `Live from uploaded data (n=${derived.sampleApc}): APC1 ≥ ${formatNumber(minApc1M)}M · Plaza ≥ ${formatTroops(minPlaza)}`
          : `Live from uploaded APC1 (n=${derived.sampleApc}): APC1 ≥ ${formatNumber(minApc1M)}M · Plaza gate pending`
    };
  }

  function formatThresholdSummary(thresholds) {
    if (!thresholds?.ready) return "insufficient alliance data";
    return `APC1 ≥ ${formatNumber(thresholds.minApc1M)}M · Plaza ≥ ${formatTroops(thresholds.minPlaza)}`;
  }

  /**
   * Recalculate RL/RJ from saved roster + current form entry.
   * Call on every relevant load/input so categories stay live.
   */
  function syncLiveRallyClassification(options = {}) {
    const role = classifyCurrentState();
    if (!options.skipScan) renderScan();

    el.wizardContent.querySelectorAll("[data-live-rally-role], [data-checklist='role']").forEach(node => {
      node.textContent = role.assigned_role === "RL" ? "Rally Leader" : "Rally Joiner";
      node.classList.toggle("gap-met", role.assigned_role === "RL");
      node.classList.toggle("gap-short", role.assigned_role !== "RL");
    });
    el.wizardContent.querySelectorAll("[data-live-rally-reason]").forEach(node => {
      node.textContent = getRallyGateReasonFromState();
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

  function loadDemo() {
    if (!isAdmin) {
      openAdminModal();
      toast("Demo roster is admin-only.", "error");
      playSfx("error");
      return;
    }
    if (roster.length && !window.confirm("Replace current roster with admin demo data (KittyKlawzz · Fisherman5)?")) return;

    roster = demoRoster.map(item => ({
      ...item,
      id: cryptoId(),
      isDemo: true,
      rallyCapacity: Number(item.rallyCapacity || 0),
      updated: Date.now() - Math.floor(Math.random() * 5000000)
    }));
    saveRoster();
    // Clear in-progress form so draft entry does not pollute RL/RJ counts.
    resetForm(false);
    renderAll();

    const leaders = roster.filter(member => getMemberRallyRole(member).assigned_role === "RL");
    const joiners = roster.filter(member => getMemberRallyRole(member).assigned_role === "RJ");
    const gate = getAllianceRallyThresholds();
    toast(
      `Admin demo loaded (${escapeHtml(formatThresholdSummary(gate))}): <strong>${leaders.length} RL</strong> · <strong>${joiners.length} RJ</strong> · KittyKlawzz · Fisherman5.`,
      "success"
    );
    playSfx("success");
  }

  function exportCSV() {
    if (!isAdmin) {
      openAdminModal();
      return;
    }
    if (!roster.length) {
      toast("There is no roster data to export yet.", "error");
      playSfx("error");
      return;
    }

    const headers = ["Player", "Level", "PH-L Rank", "Plaza Capacity", "Rally Role", "Specialty", "Personal Code", "Needs Review"];
    for (let i = 1; i <= APC_COUNT; i += 1) headers.push(`APC ${i} CP (M)`, `APC ${i} Faction`);
    headers.push("Total CP (M)", "Balance (%)", "Status", "Updated");

    const rows = [headers];
    roster.forEach(member => {
      const rally = getMemberRallyRole(member);
      const row = [
        member.name,
        formatLevel(member.level),
        member.rank,
        member.rallyCapacity || 0,
        rally.assigned_role,
        rally.specialty_faction,
        member.personalCode || "",
        memberNeedsReview(member) ? "yes" : "no"
      ];
      member.apcs.forEach(apc => {
        row.push(apc.cp, apc.faction);
      });
      row.push(
        getTotal(member),
        Number(getBalance(member.apcs).toFixed(1)),
        STATUS[getStatusKey(member.level, getMain(member))].label,
        new Date(member.updated).toISOString()
      );
      rows.push(row);
    });

    const csv = "\uFEFF" + rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `phl-apc-roster-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast("CSV exported successfully.", "success");
    playSfx("success");
  }

  function applyAdminMode() {
    document.body.classList.toggle("admin-mode", isAdmin);
    const who = adminSession?.name ? ` · ${adminSession.name}` : "";
    if (el.adminAccessLabel) {
      const full = isAdmin ? `Exit admin${who}` : "Admin access";
      const short = isAdmin ? `Exit${who}` : "Admin";
      el.adminAccessLabel.innerHTML = `<span class="admin-label-full"></span><span class="admin-label-short"></span>`;
      const fullEl = el.adminAccessLabel.querySelector(".admin-label-full");
      const shortEl = el.adminAccessLabel.querySelector(".admin-label-short");
      if (fullEl) fullEl.textContent = full;
      if (shortEl) shortEl.textContent = short;
    }
    el.adminAccessBtn.setAttribute("aria-pressed", String(isAdmin));
    if (!isAdmin) {
      clearAdminViews();
      clearAdminCommsUi();
    } else {
      // keep shared sync loop running for everyone; admin just sees roster UI
    }
  }

  function handleAdminAccess() {
    if (isAdmin) {
      void logoutAdminSession({ toastMessage: "Admin session closed." });
      return;
    }
    openAdminModal();
  }

  function openAdminModal() {
    el.adminError.textContent = "";
    el.adminCodeInput.value = "";
    openModal("admin", el.adminCodeInput);
    playSfx("transition");
  }

  function openModal(name, focusTarget) {
    const modal = name === "delete"
      ? el.deleteModal
      : name === "sync"
        ? el.syncModal
        : name === "personalCode"
          ? el.personalCodeModal
          : el.adminModal;
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(() => focusTarget?.focus(), 80);
  }

  function closeModal(name) {
    const modal = name === "delete"
      ? el.deleteModal
      : name === "sync"
        ? el.syncModal
        : name === "personalCode"
          ? el.personalCodeModal
          : el.adminModal;
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (
      !el.adminModal.classList.contains("open")
      && !el.deleteModal.classList.contains("open")
      && !el.syncModal?.classList.contains("open")
      && !el.personalCodeModal?.classList.contains("open")
      && !el.memberDrawer?.classList.contains("open")
    ) {
      document.body.classList.remove("modal-open");
    }
    if (name === "admin") el.adminError.textContent = "";
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

  async function attemptAdminLogin() {
    const code = el.adminCodeInput.value.trim();
    if (!code) {
      el.adminError.textContent = "Enter your personal admin access code.";
      playSfx("error");
      return;
    }

    const hash = await sha256(code);
    const account = getAdminAccounts().find(admin => admin.hash === hash);
    if (!account) {
      el.adminError.textContent = "Access code not recognized.";
      el.adminCodeInput.select();
      playSfx("error");
      return;
    }

    adminSession = {
      id: account.id,
      name: account.name,
      sessionId: createAdminSessionId()
    };
    isAdmin = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession));
    closeModal("admin");
    applyAdminMode();
    await startAdminRealtime({ claim: true });
    await pullCloudRoster({ silent: true });
    renderAll();
    toast(`Welcome, <strong>${escapeHtml(account.name)}</strong>. Shared roster synced.`, "success");
    playSfx("success");
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
      if (!parsed?.id || !parsed?.name) return null;
      const stillValid = getAdminAccounts().some(admin => admin.id === parsed.id);
      if (!stillValid) return null;
      const sessionId = parsed.sessionId ? String(parsed.sessionId) : createAdminSessionId();
      const session = { id: parsed.id, name: parsed.name, sessionId };
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
    if (!adminSession?.id || !adminSession?.name || !adminSession?.sessionId) return null;
    return {
      adminId: adminSession.id,
      adminName: adminSession.name,
      sessionId: adminSession.sessionId,
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
    applyAdminMode();
    renderAll();
    toast("Your admin session was taken over on another device.", "error");
    playSfx("error");
  }

  async function logoutAdminSession({ toastMessage = "Admin session closed.", playClick = true } = {}) {
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
    applyAdminMode();
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
    animateGauge(0);
    animateKpi(el.readinessValue, 0, { suffix: "%", decimals: 0, duration: 280 });
    el.readinessCopy.textContent = "Admin authentication required.";
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

  function getTotal(member) {
    return member.apcs.reduce((sum, apc) => sum + Number(apc.cp || 0), 0);
  }

  function getTotalFromState() {
    return state.apcs.reduce((sum, apc) => sum + Number(apc.cp || 0), 0);
  }

  function getBalance(apcs) {
    const values = apcs.map(apc => Number(apc.cp || 0));
    const max = Math.max(...values, 0);
    if (!max) return 0;
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

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function cryptoId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 12);
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
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

  function applyPasteInput() {
    const raw = document.getElementById("pasteInput")?.value || "";
    const parsed = parsePasteLine(raw);
    if (!parsed) {
      toast("Could not parse paste. Try: Name i5 820/760/710/655 450000", "error");
      playSfx("error");
      return;
    }
    if (parsed.name) state.name = parsed.name.slice(0, 30);
    if (parsed.level) state.level = parsed.level;
    if (parsed.rank) state.rank = parsed.rank;
    if (parsed.powers) {
      parsed.powers.forEach((cp, i) => {
        if (i < APC_COUNT) state.apcs[i].cp = clamp(cp, 0, getMaxForLevel(state.level));
      });
    }
    if (parsed.rallyCapacity != null) {
      state.rallyCapacity = Math.max(0, Math.floor(Number(parsed.rallyCapacity) || 0));
    }
    renderWizard(true);
    syncLiveRallyClassification();
    toast(parsed.rallyCapacity ? "Paste applied (APC + Plaza)." : "Paste applied.", "success");
    playSfx("success");
  }

  function parsePasteLine(text) {
    const line = String(text || "").trim().replace(/,/g, " ");
    if (!line) return null;

    const powersMatch = line.match(/(\d+(?:\.\d+)?)\s*[\/|]\s*(\d+(?:\.\d+)?)\s*[\/|]\s*(\d+(?:\.\d+)?)\s*[\/|]\s*(\d+(?:\.\d+)?)/)
      || line.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?!.*\d)/);
    if (!powersMatch) return null;

    const powers = powersMatch.slice(1, 5).map(Number);
    let rest = line.replace(powersMatch[0], " ").replace(/\s+/g, " ").trim();

    let level = null;
    const levelMatch = rest.match(/\b(i\d{1,2}|I\d{1,2}|WT\d{1,2}|\d{1,2})\b/);
    if (levelMatch) {
      level = normalizeLevelToken(levelMatch[1]);
      rest = rest.replace(levelMatch[0], " ").replace(/\s+/g, " ").trim();
    }

    let rank = null;
    const rankMatch = rest.match(/\b(R[1-5])\b/i);
    if (rankMatch) {
      rank = rankMatch[1].toUpperCase();
      rest = rest.replace(rankMatch[0], " ").replace(/\s+/g, " ").trim();
    }

    let rallyCapacity = null;
    const plazaK = rest.match(/\b(\d+(?:\.\d+)?)\s*[kK]\b/);
    const plazaRaw = rest.match(/\b(\d{5,})\b/);
    if (plazaK) {
      rallyCapacity = Math.round(Number(plazaK[1]) * 1000);
      rest = rest.replace(plazaK[0], " ").replace(/\s+/g, " ").trim();
    } else if (plazaRaw) {
      rallyCapacity = Math.floor(Number(plazaRaw[1]));
      rest = rest.replace(plazaRaw[0], " ").replace(/\s+/g, " ").trim();
    }

    const name = rest.replace(/[|/]+/g, " ").trim();
    return {
      name: name || null,
      level: level && BANDS[level] ? level : null,
      rank: RANKS.includes(rank) ? rank : null,
      powers,
      rallyCapacity
    };
  }

  function normalizeLevelToken(token) {
    const value = String(token || "");
    if (/^i\d{1,2}$/i.test(value)) return `I${value.slice(1)}`;
    if (/^WT\d{1,2}$/i.test(value)) return `WT${value.slice(2)}`;
    if (/^\d{1,2}$/.test(value)) return `WT${value}`;
    return value;
  }

  function copyDiscordReport() {
    if (!isAdmin) {
      openAdminModal();
      return;
    }
    if (!roster.length) {
      toast("No roster data to copy yet.", "error");
      playSfx("error");
      return;
    }

    const lines = [
      "**PH-L APC roster** (Dark War Survival)",
      `Updated: ${new Date().toLocaleString()}`,
      ""
    ];

    [...roster].sort((a, b) => getTotal(b) - getTotal(a)).forEach((member, index) => {
      const gap = getFrontlineGap(member.level, getMain(member));
      const rally = getMemberRallyRole(member);
      const cps = member.apcs.map(apc => `${formatNumber(apc.cp)}`).join("/");
      lines.push(
        `${index + 1}. **${member.name}** · ${formatLevel(member.level)} · ${member.rank} · ${rally.assigned_role}/${rally.specialty_faction} · plaza ${formatTroops(member.rallyCapacity || 0)} · ${cps}M · ${STATUS[getStatusKey(member.level, getMain(member))].label} · gap ${formatGap(gap)}`
      );
    });

    const leaders = roster.filter(member => getMemberRallyRole(member).assigned_role === "RL");
    const joiners = roster.filter(member => getMemberRallyRole(member).assigned_role === "RJ");
    lines.push("", `RL (${leaders.length}): ${leaders.map(m => m.name).join(", ") || "—"}`);
    lines.push(`RJ (${joiners.length}): ${joiners.map(m => m.name).join(", ") || "—"}`);

    const below = roster.filter(member => !getFrontlineGap(member.level, getMain(member)).met);
    if (below.length) {
      lines.push("", `Below frontline (${below.length}): ${below.map(m => m.name).join(", ")}`);
    }

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      toast("Discord roster copied.", "success");
      playSfx("success");
    }).catch(() => {
      toast("Clipboard blocked. Copy manually from export.", "error");
      playSfx("error");
    });
  }

  function openSyncModal() {
    if (!isAdmin) {
      openAdminModal();
      return;
    }
    const configured = isCloudConfigured();
    if (el.syncStatusText) {
      el.syncStatusText.innerHTML = configured
        ? `Shared cloud roster is live. Every member submit syncs for all admins. Use Pull to refresh, Push to force-upload this device.`
        : `Cloud not configured. Use JSON export/import, or set <code>cloudApiUrl</code> in <code>config.js</code>.`;
    }
    if (el.syncError) el.syncError.textContent = "";
    el.syncPullBtn.disabled = !configured;
    el.syncPushBtn.disabled = !configured;
    openModal("sync", el.syncCloseBtn);
    playSfx("transition");
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
    try {
      let remoteMembers = [];
      let remoteHistory = [];
      let remoteUpdatedAt = null;
      if (usesNetlifyCloud()) {
        const response = await fetch(getConfig().cloudApiUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Pull failed (${response.status})`);
        const data = await response.json();
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
      if (!silent) {
        if (el.syncError) el.syncError.textContent = error.message || "Pull failed.";
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
      const members = roster.filter(member => !member.isDemo);
      const deletedIds = [...pendingDeletedIds];
      if (usesNetlifyCloud()) {
        const response = await fetch(getConfig().cloudApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alliance_id: getAllianceId(),
            members,
            history: changeHistory,
            deleted_ids: deletedIds,
            updated_at: new Date().toISOString()
          })
        });
        if (!response.ok) throw new Error(`Push failed (${response.status})`);
        const data = await response.json();
        if (Array.isArray(data.members)) {
          const demos = roster.filter(member => member.isDemo);
          // Keep any local non-demo rows that might not be in the response yet
          roster = [...mergeRosterLists(members, data.members), ...demos];
          for (const id of deletedIds) {
            if (!roster.some(member => member.id === id)) pendingDeletedIds.delete(id);
          }
          if (Array.isArray(data.history)) {
            changeHistory = mergeHistoryLists(changeHistory, data.history);
            saveHistory();
          }
          lastCloudFingerprint = rosterFingerprint(data.members, data.updated_at);
          saveRoster();
          renderAll();
        }
      } else {
        const cfg = getConfig();
        const payload = {
          alliance_id: getAllianceId(),
          members,
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
    if (!pending.length && !pendingDeletedIds.size) return true;
    for (const member of pending) upsertMember(member);
    saveRoster();
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
        .then(() => (isAdmin ? pullCloudRoster({ silent: true }) : Promise.resolve()))
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
      .then(() => (isAdmin ? pullCloudRoster({ silent: true }) : Promise.resolve()))
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
    const max = getMaxForLevel(level);
    const personalCode = normalizePersonalCode(item.personalCode);
    const needsReview = Boolean(item.needsReview) || /\]-updt$/i.test(name) || /-updt$/i.test(name);
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
      apcs: Array.from({ length: APC_COUNT }, (_, i) => ({
        cp: clamp(Number(item.apcs?.[i]?.cp || 0), 0, max),
        faction: FACTIONS.includes(item.apcs?.[i]?.faction) ? item.apcs[i].faction : "Fighter"
      }))
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
    const watch = ["name", "level", "rank", "rallyCapacity", "personalCode", "needsReview"];
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
      el.historyList.innerHTML = `<div class="empty"><strong>No history yet</strong><p>Member creates, overwrites, and admin edits will appear here.</p></div>`;
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

  function buildMember(name, level, rank, powers, factions, rallyCapacity = 0) {
    return {
      id: cryptoId(),
      name,
      level,
      rank,
      rallyCapacity: Math.max(0, Math.floor(Number(rallyCapacity || 0))),
      updated: Date.now(),
      apcs: Array.from({ length: APC_COUNT }, (_, i) => ({
        cp: Number(powers[i] || 0),
        faction: factions[i] || "Fighter"
      }))
    };
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
    return classifyMemberPayload({
      id: editingId || "draft",
      name: state.name || "Draft",
      apc1_cp: toAbsoluteCp(state.apcs[0].cp),
      rally_capacity: Number(state.rallyCapacity || 0),
      apc1_faction: state.apcs[0].faction
    });
  }

  function getMemberRallyRole(member) {
    return classifyMemberPayload({
      id: member.id,
      name: member.name,
      apc1_cp: toAbsoluteCp(getMain(member)),
      rally_capacity: Number(member.rallyCapacity || 0),
      apc1_faction: member.apcs?.[0]?.faction || "Fighter"
    });
  }

  function classifyMemberPayload(input) {
    const thresholds = getAllianceRallyThresholds();
    if (!thresholds.ready) {
      const faction = ["Fighter", "Shooter", "Rider"].includes(input.apc1_faction) ? input.apc1_faction : "Fighter";
      return { ...input, assigned_role: "RJ", specialty_faction: faction };
    }
    const gate = {
      minApc1Cp: thresholds.minApc1Cp,
      minRallyCapacity: thresholds.minRallyCapacity
    };
    const api = window.PHL_RALLY_ROLES;
    if (api?.classifyMember) return api.classifyMember(input, gate);
    const cpOk = Number(input.apc1_cp) >= gate.minApc1Cp;
    const capOk = gate.minRallyCapacity <= 0 || Number(input.rally_capacity) >= gate.minRallyCapacity;
    const faction = ["Fighter", "Shooter", "Rider"].includes(input.apc1_faction) ? input.apc1_faction : "Fighter";
    return { ...input, assigned_role: cpOk && capOk ? "RL" : "RJ", specialty_faction: faction };
  }

  function getRallyGateReasonFromState() {
    return getRallyGateReason({
      rallyCapacity: state.rallyCapacity,
      apcs: state.apcs
    });
  }

  function getRallyGateReason(member) {
    const thresholds = getAllianceRallyThresholds();
    if (!thresholds.ready) return "Waiting for uploaded alliance CP";
    const main = getMain(member);
    const absCp = toAbsoluteCp(main);
    const cap = Number(member.rallyCapacity || 0);
    const cpOk = absCp >= thresholds.minApc1Cp;
    const capOk = thresholds.minRallyCapacity <= 0 || cap >= thresholds.minRallyCapacity;
    if (cpOk && capOk) return thresholds.source === "manual" ? "RL vs selected target" : "RL vs live uploaded median";
    const parts = [];
    if (!cpOk) {
      parts.push(
        thresholds.source === "manual"
          ? `APC1 ${formatNumber(main)}M < target ${formatNumber(thresholds.minApc1M)}M`
          : `APC1 ${formatNumber(main)}M < live ${formatNumber(thresholds.minApc1M)}M`
      );
    }
    if (!capOk) {
      parts.push(
        thresholds.source === "manual"
          ? `Plaza ${formatTroops(cap)} < target ${formatTroops(thresholds.minPlaza)}`
          : `Plaza ${formatTroops(cap)} < live ${formatTroops(thresholds.minPlaza)}`
      );
    }
    return parts.join(" · ") || "RJ";
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
