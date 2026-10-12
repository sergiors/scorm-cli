import type { ContentManifest } from './content-manifest'
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
    suspendDataLimit: 64000,
    completion: {
      element: 'cmi.completion_status',
      incomplete: 'incomplete',
      completed: 'completed'
    },
    exit: 'cmi.exit'
  }
}

const emptyManifest: ContentManifest = {
  schemaVersion: 1,
  title: '',
  lang: 'en',
  presentation: 'scroll',
  pages: {}
}

/**
 * Builds the SCO bridge source shared by the fixed-version production runtime
 * and the version-aware preview runtime. `apiMappingDeclaration` is the only
 * point of variation: production pins one mapping, preview resolves the mapping
 * the mock selected at startup.
 */
function buildRuntimeSource(manifest: ContentManifest, apiMappingDeclaration: string): string {
  const dictionary = JSON.stringify(manifest).replace(/</g, '\\u003c')
  return `;(function () {
  var CONTENT_MANIFEST = ${dictionary};
  ${apiMappingDeclaration}
  var api = null;
  var finished = false;
  var initialized = false;
  var alreadyComplete = false;
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
    var entries = Object.keys(CONTENT_MANIFEST.pages).map(function (key) { return CONTENT_MANIFEST.pages[key]; });
    if (!entries.length) return 0;
    var done = entries.reduce(function (count, page) {
      var value = state && state.pages && state.pages[page.id];
      var complete = CONTENT_MANIFEST.presentation === "scroll"
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

  initialized = call(API_MAPPING.initialize, "lms.initialize", undefined, "") === "true";
  if (initialized) {
    var status = call(API_MAPPING.getValue, "lms.get-value", API_MAPPING.completion.element, API_MAPPING.completion.element);
    alreadyComplete = status === "completed" || (API_MAPPING.discoveryProperty === "API" && status === "passed");
    currentLocation = call(API_MAPPING.getValue, "lms.get-value", API_MAPPING.location, API_MAPPING.location);
    resumeState = compactDecode(CONTENT_MANIFEST, call(API_MAPPING.getValue, "lms.get-value", "cmi.suspend_data", "cmi.suspend_data"));
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
    if (!alreadyComplete) call(API_MAPPING.setValue, "lms.set-value", API_MAPPING.exit, API_MAPPING.exit, "suspend");
    call(API_MAPPING.commit, "lms.commit", undefined, "");
    call(API_MAPPING.terminate, "lms.finish", undefined, "");
  }

  function restoreState() {
    if (!api || !initialized) return { pages: {} };
    var restored = compactDecode(CONTENT_MANIFEST, compactEncode(CONTENT_MANIFEST, resumeState, progressFor(resumeState)));
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
      var serialized = compactEncode(CONTENT_MANIFEST, state, progressFor(state));
      var normalized = compactDecode(CONTENT_MANIFEST, serialized);
      var saved = true;
      if (state && typeof state.location === "string") {
        currentLocation = state.location;
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
    finish: finish
  };

  if (window.addEventListener) window.addEventListener("beforeunload", finish, false);
})();`
}

/** Creates a fixed-version SCO bridge with the dictionary written into the package. */
export function createScormRuntime(
  manifest: ContentManifest,
  version: ScormVersion = '1.2'
): string {
  return buildRuntimeSource(
    manifest,
    `var API_MAPPING = ${JSON.stringify(runtimeApiMappings[version])};`
  )
}

/**
 * Creates the version-aware runtime injected by `scorm preview`. The dev mock
 * runs first and records the selected version on the page, so this source binds
 * to the matching API mapping at startup. It reuses the exact production
 * template and `runtimeApiMappings`; packages never emit it.
 */
export function createScormPreviewRuntime(manifest: ContentManifest): string {
  return buildRuntimeSource(
    manifest,
    `var PREVIEW_RUNTIME_MAPPINGS = ${JSON.stringify(runtimeApiMappings)};
  var PREVIEW_SCORM_VERSION = window.__SCORM_PREVIEW_VERSION__ === "2004" ? "2004" : "1.2";
  var API_MAPPING = PREVIEW_RUNTIME_MAPPINGS[PREVIEW_SCORM_VERSION];`
  )
}

/** Empty-dictionary compatibility export; packages should call createScormRuntime. */
export const scormRuntime = createScormRuntime(emptyManifest)
