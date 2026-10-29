import type { ScoIndex } from './sco-index'
import { browserCodecSource } from './state-codec'
import type { ScormVersion } from './scorm-version'

interface RuntimeApiMapping {
  discoveryProperty: 'API' | 'API_1484_11'
  initialize: 'LMSInitialize' | 'Initialize'
  getValue: 'LMSGetValue' | 'GetValue'
  setValue: 'LMSSetValue' | 'SetValue'
  commit: 'LMSCommit' | 'Commit'
  terminate: 'LMSFinish' | 'Terminate'
  location: 'cmi.core.lesson_location' | 'cmi.location'
  sessionTime: 'cmi.core.session_time' | 'cmi.session_time'
  totalTime: 'cmi.core.total_time' | 'cmi.total_time'
  score: {
    min: 'cmi.core.score.min' | 'cmi.score.min'
    max: 'cmi.core.score.max' | 'cmi.score.max'
    raw: 'cmi.core.score.raw' | 'cmi.score.raw'
    scaled?: 'cmi.score.scaled'
  }
  suspendDataLimit: 4096 | 64000
  completion: {
    element: 'cmi.core.lesson_status' | 'cmi.completion_status'
    incomplete: 'incomplete'
    completed: 'completed'
  }
  exit: 'cmi.core.exit' | 'cmi.exit'
}

/**
 * Single source of truth for every version-specific API method and CMI element
 * name. The fixed-version production runtime and the preview mock both derive
 * from it, so a version's method names can never drift between them.
 */
export const runtimeApiMappings: Record<ScormVersion, RuntimeApiMapping> = {
  '1.2': {
    discoveryProperty: 'API',
    initialize: 'LMSInitialize',
    getValue: 'LMSGetValue',
    setValue: 'LMSSetValue',
    commit: 'LMSCommit',
    terminate: 'LMSFinish',
    location: 'cmi.core.lesson_location',
    sessionTime: 'cmi.core.session_time',
    totalTime: 'cmi.core.total_time',
    score: {
      min: 'cmi.core.score.min',
      max: 'cmi.core.score.max',
      raw: 'cmi.core.score.raw'
    },
    suspendDataLimit: 4096,
    completion: {
      element: 'cmi.core.lesson_status',
      incomplete: 'incomplete',
      completed: 'completed'
    },
    exit: 'cmi.core.exit'
  },
  '2004': {
    discoveryProperty: 'API_1484_11',
    initialize: 'Initialize',
    getValue: 'GetValue',
    setValue: 'SetValue',
    commit: 'Commit',
    terminate: 'Terminate',
    location: 'cmi.location',
    sessionTime: 'cmi.session_time',
    totalTime: 'cmi.total_time',
    score: {
      min: 'cmi.score.min',
      max: 'cmi.score.max',
      raw: 'cmi.score.raw',
      scaled: 'cmi.score.scaled'
    },
    suspendDataLimit: 64000,
    completion: {
      element: 'cmi.completion_status',
      incomplete: 'incomplete',
      completed: 'completed'
    },
    exit: 'cmi.exit'
  }
}

const emptyIndex: ScoIndex = {
  schemaVersion: 1,
  title: '',
  lang: 'en',
  presentation: 'scroll',
  pages: {}
}

// These exported formatters mirror the inlined runtime helpers and are covered by runtime-source tests.
/** Format elapsed milliseconds as SCORM 1.2 HHHH:MM:SS.ss. */
export function formatScorm12Duration(milliseconds: number): string {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10))
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor((centiseconds % 360000) / 6000)
  const seconds = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100
  return `${String(hours).padStart(4, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

/** Format elapsed milliseconds as an ISO 8601 SCORM 2004 duration. */
export function formatScorm2004Duration(milliseconds: number): string {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10))
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor((centiseconds % 360000) / 6000)
  const seconds = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100
  const secondsText = fraction ? `${seconds}.${String(fraction).padStart(2, '0')}` : String(seconds)
  const time = `${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${seconds || fraction ? `${secondsText}S` : ''}`
  return `PT${time || '0S'}`
}

/**
 * Builds the SCO bridge source shared by the fixed-version production runtime
 * and the version-aware preview runtime. `apiMappingDeclaration` is the only
 * point of variation: production pins one mapping, preview resolves the mapping
 * the mock selected at startup.
 */
function buildRuntimeSource(index: ScoIndex, apiMappingDeclaration: string): string {
  const dictionary = JSON.stringify(index).replace(/</g, '\\u003c')
  return `;(function () {
  var SCO_INDEX = ${dictionary};
  ${apiMappingDeclaration}
  var api = null;
  var finished = false;
  var initialized = false;
  var alreadyComplete = false;
  var sessionStartedAt = null;
  var sessionFallbackStartedAt = null;
  var usePerformanceClock = false;
  var currentLocation = "";
  var resumeState = { pages: {} };

  function emit(name, details) {
    if (window.__SCORM_DEVTOOLS__ !== true) return;
    var event = { name: name, at: Date.now(), details: details || {} };
    try {
      if (window.console && typeof window.console.debug === "function") {
        window.console.debug("[scorm]", event);
      }
    } catch (_) {}
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
${browserCodecSource()}

  function progressFor(state) {
    var entries = Object.keys(SCO_INDEX.pages).map(function (key) { return SCO_INDEX.pages[key]; });
    if (!entries.length) return 0;
    var done = entries.reduce(function (count, page) {
      var value = state && state.pages && state.pages[page.id];
      var complete = SCO_INDEX.presentation === "scroll" || SCO_INDEX.presentation === "slides"
        ? value && value.completed === true
        : value && value.visited === true;
      return count + (complete ? 1 : 0);
    }, 0);
    return Math.max(0, Math.min(100, Math.round(done * 100 / entries.length)));
  }

  function findApi(start) {
    var current = start;
    for (var i = 0; current && i < 8; i++) {
      try {
        var candidate = current[API_MAPPING.discoveryProperty];
        if (candidate && typeof candidate === "object") return candidate;
        if (!current.parent || current.parent === current) break;
        current = current.parent;
      } catch (_) { break; }
    }
    return null;
  }

  try { api = findApi(window); } catch (_) {}
  if (!api) { try { api = findApi(window.opener); } catch (_) {} }
  if (window.__SCORM_DEVTOOLS__ === true) {
    emit(api ? "lms.api-found" : "lms.api-missing", api ? {} : { reason: "api-not-found" });
  }

  function call(name, eventName, key, value, secondValue) {
    var details = window.__SCORM_DEVTOOLS__ === true ? { method: name } : null;
    var eventValue = secondValue === undefined ? value : secondValue;
    if (details && key !== undefined) details.key = key;
    // For reads the payload is only known after the LMS responds, so value
    // and length are populated on success below. Writes report the attempted
    // value up front even when the LMS later rejects it.
    if (details && eventValue !== undefined && eventName !== "lms.get-value") {
      details.value = eventValue;
      if (key === "cmi.suspend_data") details.length = String(eventValue).length;
    }
    if (!api) {
      if (details) details.reason = "api-not-found";
      emit(eventName, details);
      return "";
    }
    if (typeof api[name] !== "function") {
      if (details) details.reason = "method-unavailable";
      emit(eventName, details);
      return "";
    }
    try {
      var result = secondValue === undefined
        ? api[name](value == null ? "" : String(value))
        : api[name](String(value), String(secondValue));
      result = result == null ? "" : String(result);
      if (details) {
        details.result = result;
        if (eventName === "lms.get-value") {
          details.value = result;
          if (key === "cmi.suspend_data") details.length = result.length;
        }
      }
      emit(eventName, details);
      return result;
    } catch (error) {
      if (details) {
        details.result = "";
        details.error = error && error.message ? String(error.message) : String(error);
      }
      emit(eventName, details);
      return "";
    }
  }

  function startSessionTimer() {
    sessionFallbackStartedAt = Date.now();
    try {
      if (window.performance && typeof window.performance.now === "function") {
        var now = window.performance.now();
        if (typeof now === "number" && isFinite(now)) {
          sessionStartedAt = now;
          usePerformanceClock = true;
          return;
        }
      }
    } catch (_) {}
    sessionStartedAt = sessionFallbackStartedAt;
    usePerformanceClock = false;
  }

  function roundDecimal(value, places) {
    var factor = Math.pow(10, places);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function elapsedMilliseconds() {
    if (usePerformanceClock) {
      try {
        var now = window.performance.now();
        if (typeof now === "number" && isFinite(now)) return Math.max(0, now - sessionStartedAt);
      } catch (_) {}
      usePerformanceClock = false;
    }
    return Math.max(0, Date.now() - sessionFallbackStartedAt);
  }

  function formatSessionDuration(milliseconds) {
    var centiseconds = Math.max(0, Math.round(milliseconds / 10));
    var hours = Math.floor(centiseconds / 360000);
    var minutes = Math.floor((centiseconds % 360000) / 6000);
    var seconds = Math.floor((centiseconds % 6000) / 100);
    var fraction = centiseconds % 100;
    if (API_MAPPING.discoveryProperty === "API") {
      return String(hours).padStart(4, "0") + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + String(fraction).padStart(2, "0");
    }
    var secondsText = fraction ? String(seconds) + "." + String(fraction).padStart(2, "0") : String(seconds);
    var duration = (hours ? String(hours) + "H" : "") + (minutes ? String(minutes) + "M" : "") + ((seconds || fraction) ? secondsText + "S" : "");
    return "PT" + (duration || "0S");
  }

  initialized = call(API_MAPPING.initialize, "lms.initialize", undefined, "") === "true";
  if (initialized) {
    startSessionTimer();
    var status = call(API_MAPPING.getValue, "lms.get-value", API_MAPPING.completion.element, API_MAPPING.completion.element);
    alreadyComplete = status === "completed" || (API_MAPPING.discoveryProperty === "API" && status === "passed");
    currentLocation = call(API_MAPPING.getValue, "lms.get-value", API_MAPPING.location, API_MAPPING.location);
    resumeState = compactDecode(SCO_INDEX, call(API_MAPPING.getValue, "lms.get-value", "cmi.suspend_data", "cmi.suspend_data"));
    resumeState.location = currentLocation;
    if (!alreadyComplete) call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.completion.element, API_MAPPING.completion.element, API_MAPPING.completion.incomplete);
    call(API_MAPPING.commit, "lms.commit", undefined, "");
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (!initialized) {
      if (window.__SCORM_DEVTOOLS__ === true) emit("lms.finish", { method: API_MAPPING.terminate, reason: api ? "not-initialized" : "api-not-found" });
      return;
    }
    call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.sessionTime, API_MAPPING.sessionTime, formatSessionDuration(elapsedMilliseconds()));
    if (!alreadyComplete) call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.exit, API_MAPPING.exit, "suspend");
    call(API_MAPPING.commit, "lms.commit", undefined, "");
    call(API_MAPPING.terminate, "lms.finish", undefined, "");
  }

  function restoreState() {
    if (!api || !initialized) return { pages: {} };
    var restored = compactDecode(SCO_INDEX, compactEncode(SCO_INDEX, resumeState, progressFor(resumeState)));
    restored.location = currentLocation;
    return restored;
  }

  window.scormBridge = {
    getLocation: function () {
      if (!api || !initialized) return "";
      return currentLocation;
    },
    restoreState: restoreState,
    getResumeState: restoreState,
    saveState: function (state) {
      if (!api || !initialized) return false;
      var serialized = compactEncode(SCO_INDEX, state, progressFor(state));
      var normalized = compactDecode(SCO_INDEX, serialized);
      var saved = true;
      var location = state && typeof state.location === "string" ? state.location : "";
      var anchor = state && typeof state.anchor === "string" ? state.anchor : "";
      if (location && anchor && location.indexOf("#") < 0) {
        location = location + "#" + anchor;
      }
      if (location) {
        currentLocation = location;
        normalized.location = currentLocation;
        if (call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.location, API_MAPPING.location, currentLocation) !== "true") saved = false;
      }
      if (serialized.length > API_MAPPING.suspendDataLimit) {
        emit("lms.suspend-data-too-large", { length: serialized.length, limit: API_MAPPING.suspendDataLimit });
        saved = false;
      } else if (call(API_MAPPING.setValue, "lms.set-value", "cmi.suspend_data", "cmi.suspend_data", serialized) !== "true") {
        saved = false;
      }
      resumeState = normalized;
      if (call(API_MAPPING.commit, "lms.commit", undefined, "") !== "true") saved = false;
      return saved;
    },
    markCompleted: function () {
      if (!api || !initialized || alreadyComplete) return;
      if (call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.completion.element, API_MAPPING.completion.element, API_MAPPING.completion.completed) === "true") {
        call(API_MAPPING.commit, "lms.commit", undefined, "");
        alreadyComplete = true;
      }
    },
    setScore: function (score) {
      if (!api || !initialized || !score || typeof score.earned !== "number" || !isFinite(score.earned) || typeof score.possible !== "number" || !isFinite(score.possible) || score.possible <= 0) return false;
      var raw = Math.max(0, Math.min(100, roundDecimal((score.earned / score.possible) * 100, 2)));
      var saved = true;
      if (call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.score.min, API_MAPPING.score.min, "0") !== "true") saved = false;
      if (call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.score.max, API_MAPPING.score.max, "100") !== "true") saved = false;
      if (call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.score.raw, API_MAPPING.score.raw, String(raw)) !== "true") saved = false;
      if (API_MAPPING.score.scaled) {
        if (call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.score.scaled, API_MAPPING.score.scaled, String(roundDecimal(raw / 100, 4))) !== "true") saved = false;
      }
      if (!saved) return false;
      return call(API_MAPPING.commit, "lms.commit", undefined, "") === "true";
    },
    finish: finish
  };

  if (window.addEventListener) window.addEventListener("beforeunload", finish, false);
})();`
}

/** Creates a fixed-version SCO bridge with the dictionary written into the package. */
export function createScormRuntime(index: ScoIndex, version: ScormVersion = '1.2'): string {
  return buildRuntimeSource(
    index,
    `var API_MAPPING = ${JSON.stringify(runtimeApiMappings[version])};`
  )
}

/**
 * Creates the version-aware runtime injected by `scorm preview`. The dev mock
 * runs first and records the selected version on the page, so this source binds
 * to the matching API mapping at startup. It reuses the exact production
 * template and `runtimeApiMappings`; packages never emit it.
 */
export function createScormPreviewRuntime(index: ScoIndex): string {
  return buildRuntimeSource(
    index,
    `var PREVIEW_RUNTIME_MAPPINGS = ${JSON.stringify(runtimeApiMappings)};
  var PREVIEW_SCORM_VERSION = window.__SCORM_PREVIEW_VERSION__ === "2004" ? "2004" : "1.2";
  var API_MAPPING = PREVIEW_RUNTIME_MAPPINGS[PREVIEW_SCORM_VERSION];`
  )
}

/** Empty-dictionary compatibility export; packages should call createScormRuntime. */
export const scormRuntime = createScormRuntime(emptyIndex)
