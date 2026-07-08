/*
  Cash Flow module — public barrel.
  Import everything from "@/lib/cashflow" so the UI never reaches into internals.
*/
export * from "./types";
export * from "./config";
export * from "./dates";
export * from "./logic";
export * from "./service";
export * from "./export";
export {
  CASH_SOURCES,
  FORECAST_SOURCES_WIRING,
  isGated,
  fetchTransactions,
  fetchBankAccounts,
  fetchForecast,
} from "./engine";
