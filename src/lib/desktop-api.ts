import { invoke } from "@tauri-apps/api/core";

export type DesktopTableName =
  | "users"
  | "companies"
  | "customers"
  | "customer_managers"
  | "ports"
  | "products"
  | "contract_terms"
  | "term_configurations"
  | "term_configuration_items"
  | "contracts";

type TermConfigurationItemPayload = {
  item_code: string;
  term_id: number;
  sort_order: number;
};

type GenerateContractPayload = {
  contractNo: string;
  fields: Record<string, string>;
  logoData?: string;
};

export const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export const tauriApi = {
  list(tableName: DesktopTableName) {
    return invoke<Record<string, unknown>[]>("db_list", { tableName });
  },
  create(tableName: DesktopTableName, payload: Record<string, unknown>) {
    return invoke<{ id: number }>("db_create", { tableName, payload });
  },
  update(tableName: DesktopTableName, id: number, payload: Record<string, unknown>) {
    return invoke<{ id: number }>("db_update", { tableName, id, payload });
  },
  deleteMany(tableName: DesktopTableName, ids: number[]) {
    return invoke<{ count: number }>("db_delete_many", { tableName, ids });
  },
  replaceTermConfigurationItems(configId: number, items: TermConfigurationItemPayload[]) {
    return invoke<{ configId: number; count: number }>("db_replace_term_configuration_items", {
      configId,
      items,
    });
  },
  meta() {
    return invoke<{ dbPath: string; tables: string[] }>("db_meta");
  },
  generateContractPdf(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_contract_pdf", { payload });
  },
  generateContractExcel(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_contract_excel", { payload });
  },
  generatePiPdf(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_pi_pdf", { payload });
  },
  generatePiExcel(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_pi_excel", { payload });
  },
  generatePackingListPdf(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_packing_list_pdf", { payload });
  },
  generatePackingListExcel(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_packing_list_excel", { payload });
  },
  generateCommercialInvoicePdf(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_commercial_invoice_pdf", { payload });
  },
  generateCommercialInvoiceExcel(payload: GenerateContractPayload) {
    return invoke<{ path: string }>("generate_commercial_invoice_excel", { payload });
  },
  openGeneratedContract(path: string) {
    return invoke<void>("open_generated_contract", { path });
  },
};
