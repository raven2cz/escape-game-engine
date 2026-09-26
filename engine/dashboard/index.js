// engine/dashboard/index.js
//
// The dashboard layer's public entry point. A board, the hosted runtime or a
// test imports from here; nothing outside engine/ should reach into the files
// behind it. The engine core imports only what it needs to publish signals and
// keep `state.progress`.

export {GameSignals, SIGNALS} from './signals.js';
export {systemClock, manualClock} from './clock.js';
export {buildCatalogue, validateDashboardMeta, reachableTasks, collectFlags, plainText} from './catalogue.js';
export {ProgressModel, freshProgress, normalizeProgress, PROGRESS_LIMITS} from './progress-model.js';
export {project} from './projector.js';
export {
    REPORT_SCHEMA, DASHBOARD_API_VERSION, WIRE_TARGET_BYTES, WIRE_MAX_BYTES,
    toWire, checkReport, wireBytes,
} from './report.js';
export {DashboardReporter} from './reporter.js';
export {NullTransport, HttpTransport, LocalBoardTransport, localBoardKey} from './transports.js';
