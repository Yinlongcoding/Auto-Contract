import {
  AlertTriangle,
  Anchor,
  Building2,
  ChevronDown,
  CircleCheck,
  Edit3,
  Eye,
  FileSpreadsheet,
  GripVertical,
  Info,
  ListChecks,
  LogIn,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save,
  ScrollText,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { isTauriRuntime, tauriApi } from "@/lib/desktop-api";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

type TableName =
  | "companies"
  | "customers"
  | "customer_managers"
  | "ports"
  | "products"
  | "contract_terms"
  | "term_configurations"
  | "term_configuration_items"
  | "contracts";

type Row = Record<string, any>;

type ContractDraft = {
  contract_no: string;
  issue_date: string;
  buyer_id: string;
  seller_id: string;
  customer_manager_id: string;
  product_id: string;
  term_configuration_id: string;
  quantity: string;
  unit_price: string;
  advance_amount: string;
  destination_port: string;
  loading_port: string;
  trade_terms: "" | "FOB" | "CIF" | "CFR";
  expiry_date: string;
  pi_expiry_date: string;
  palletized: "" | "yes" | "no";
  drum_count: string;
  purchase_no: string;
  purchase_no_touched: string;
};

type ContractPreview = ReturnType<typeof buildContractPreviewFromRows>;

type SectionId =
  | "contract"
  | "customers"
  | "customerManagers"
  | "products"
  | "ports"
  | "companies"
  | "contractTerms"
  | "history";

type BasicSectionId = Exclude<SectionId, "contract" | "contractTerms" | "history">;
type TermSectionId = "terms" | "termConfigurations";
type DataSectionId = BasicSectionId | TermSectionId;

type FieldDefinition = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "file" | "yesno";
};

type TermConfigurationDraftItem = {
  draft_id: string;
  term_id: string;
};

type TermConfigurationFormState = {
  config_no: string;
  config_date: string;
  items: TermConfigurationDraftItem[];
};

type AppMessageDialogState = {
  title: string;
  message: string;
  tone: "info" | "success" | "error" | "warning";
  mode: "alert" | "confirm";
  confirmText?: string;
  cancelText?: string;
  resolve: (confirmed: boolean) => void;
};

type LoginVerificationResult =
  | { status: "valid" }
  | { status: "invalid"; message: string }
  | { status: "expired"; message: string }
  | { status: "notYetValid"; message: string };

type LoginVerificationResponse = {
  valid?: boolean;
  message?: string;
};

const LOGIN_VERIFY_URL = "https://auto-contract-auth.wnhoper.workers.dev/verify-login";
const LOGIN_WINDOW_SIZE = new LogicalSize(452, 392);
const MAIN_WINDOW_SIZE = new LogicalSize(1280, 820);
const MAIN_WINDOW_MIN_SIZE = new LogicalSize(1080, 680);

const AppAlertContext = createContext<(message: string, title?: string, tone?: AppMessageDialogState["tone"]) => void>(() => undefined);

function useAppAlert() {
  return useContext(AppAlertContext);
}

const api = isTauriRuntime
  ? tauriApi
  : {
      async list() {
        return [];
      },
      async create() {
        return { id: Date.now() };
      },
      async update(_table: TableName, id: number) {
        return { id };
      },
      async deleteMany(_table: TableName, ids: number[]) {
        return { count: ids.length };
      },
      async replaceTermConfigurationItems(_configId?: number, _items?: { item_code: string; term_id: number; sort_order: number }[]) {
        return { configId: 0, count: 0 };
      },
      async generateContractPdf(): Promise<{ path: string }> {
        throw new Error("请在桌面应用中生成合同 PDF。");
      },
      async generatePiPdf(): Promise<{ path: string }> {
        throw new Error("请在桌面应用中生成 PI PDF。");
      },
      async generatePackingListPdf(): Promise<{ path: string }> {
        throw new Error("请在桌面应用中生成箱单 PDF。");
      },
      async generateCommercialInvoicePdf(): Promise<{ path: string }> {
        throw new Error("请在桌面应用中生成发票 PDF。");
      },
      async openGeneratedContract() {
        throw new Error("请在桌面应用中打开文件。");
      },
    };

const today = new Date().toISOString().slice(0, 10);
const defaultExpiryDate = addDays(today, 90);
const customerTypeOptions = ["终端客户", "贸易商"] as const;
let updateCheckStarted = false;

const sections: Array<{ id: SectionId; label: string; icon: typeof FileSpreadsheet }> = [
  { id: "contract", label: "单据生成", icon: FileSpreadsheet },
  { id: "customers", label: "客户管理", icon: Users },
  { id: "customerManagers", label: "客户经理", icon: UserCog },
  { id: "products", label: "产品管理", icon: Package },
  { id: "ports", label: "港口管理", icon: Anchor },
  { id: "companies", label: "贸易户头", icon: Building2 },
  { id: "contractTerms", label: "合同条款", icon: ScrollText },
  { id: "history", label: "历史单据", icon: FileSpreadsheet },
];

const sectionTables: Record<DataSectionId, TableName> = {
  customers: "customers",
  customerManagers: "customer_managers",
  products: "products",
  ports: "ports",
  companies: "companies",
  terms: "contract_terms",
  termConfigurations: "term_configurations",
};

const fieldDefinitions: Record<DataSectionId, FieldDefinition[]> = {
  customers: [
    { key: "company_name_en", label: "公司名称 EN" },
    { key: "company_name_cn", label: "公司名称 CN" },
    { key: "address", label: "地址", type: "textarea" },
    { key: "phone", label: "电话" },
    { key: "customer_type", label: "性质" },
    { key: "country", label: "国家 EN" },
    { key: "country_cn", label: "国家 CN" },
    { key: "email", label: "邮箱" },
    { key: "contact_person", label: "联系人" },
    { key: "ntn", label: "NTN" },
  ],
  customerManagers: [
    { key: "name", label: "姓名" },
    { key: "phone", label: "电话" },
    { key: "email", label: "邮箱" },
  ],
  products: [
    { key: "name_en", label: "品名 EN" },
    { key: "name_cn", label: "品名 CN" },
    { key: "hs_code", label: "HSCODE" },
    { key: "model", label: "纯度/规格" },
    { key: "kgs_per_drum", label: "装桶规格 KG/桶", type: "number" },
    { key: "cas", label: "CAS" },
    { key: "is_drug_precursor", label: "是否易制毒前体", type: "yesno" },
  ],
  ports: [
    { key: "name_en", label: "港口信息 EN" },
    { key: "name_cn", label: "港口信息 CN" },
  ],
  companies: [
    { key: "company_name_en", label: "公司名称 EN" },
    { key: "company_name_cn", label: "公司名称 CN" },
    { key: "address", label: "地址", type: "textarea" },
    { key: "bank_name_en", label: "开户行 EN" },
    { key: "bank_name_cn", label: "开户行 CN" },
    { key: "swift_code", label: "SWIFT CODE" },
    { key: "usd_account", label: "USD ACCOUNT" },
    { key: "content", label: "备注", type: "textarea" },
    { key: "logo_data", label: "LOGO", type: "file" },
  ],
  terms: [
    { key: "term_code", label: "条款编码" },
    { key: "content_cn", label: "中文条款", type: "textarea" },
    { key: "content_en", label: "英文条款", type: "textarea" },
  ],
  termConfigurations: [
    { key: "config_no", label: "条款编号" },
    { key: "config_date", label: "配置日期", type: "date" },
  ],
};

const tableColumns: Record<DataSectionId, string[]> = {
  customers: ["company_name_en", "customer_type", "country_cn", "email", "contact_person"],
  customerManagers: ["name", "phone", "email"],
  products: ["name_en", "name_cn", "hs_code", "model", "kgs_per_drum", "cas"],
  ports: ["name_en", "name_cn"],
  companies: ["company_name_cn", "company_name_en", "bank_name_en", "swift_code", "usd_account"],
  terms: ["term_code", "content_cn", "content_en"],
  termConfigurations: ["config_no", "config_date"],
};

const titles: Record<SectionId | TermSectionId, string> = {
  contract: "单据生成",
  customers: "客户管理",
  customerManagers: "客户经理",
  products: "产品管理",
  ports: "港口管理",
  companies: "贸易户头",
  contractTerms: "合同条款",
  history: "历史单据",
  terms: "条款管理",
  termConfigurations: "条款配置",
};

function installDesktopShortcutGuards() {
  const blockEvent = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (shouldBlockDesktopShortcut(event)) {
      blockEvent(event);
    }
  };

  const onMouseNavigation = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) {
      blockEvent(event);
    }
  };

  const onContextMenu = (event: MouseEvent) => blockEvent(event);

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("mousedown", onMouseNavigation, true);
  window.addEventListener("auxclick", onMouseNavigation, true);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("mousedown", onMouseNavigation, true);
    window.removeEventListener("auxclick", onMouseNavigation, true);
  };
}

function shouldBlockDesktopShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const code = event.code.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  const refreshKeys = key === "f5" || key === "browserrefresh" || code === "browserrefresh" || (command && key === "r");
  const devtoolsKeys =
    key === "f12" ||
    (command && event.shiftKey && ["i", "j", "c", "k"].includes(key)) ||
    (command && event.altKey && key === "i");
  const browserNavigationKeys =
    key === "browserback" ||
    key === "browserforward" ||
    code === "browserback" ||
    code === "browserforward" ||
    (event.altKey && (key === "arrowleft" || key === "arrowright"));
  const sourceKeys = command && key === "u";

  return refreshKeys || devtoolsKeys || browserNavigationKeys || sourceKeys;
}

async function checkForAppUpdate(confirmUpdate: () => Promise<boolean>) {
  if (!isTauriRuntime || updateCheckStarted) {
    return;
  }

  updateCheckStarted = true;
  try {
    const update = await check();
    if (!update) {
      return;
    }
    const shouldUpdate = await confirmUpdate();
    if (!shouldUpdate) {
      await exit(0);
      return;
    }
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    console.error("Failed to check for app updates", error);
  }
}

export function App() {
  const [authState, setAuthState] = useState<"signedOut" | "loadingApp" | "signedIn">("signedOut");
  const [loginCredential, setLoginCredential] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginChecking, setLoginChecking] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("contract");
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedPath, setGeneratedPath] = useState("");
  const [modal, setModal] = useState<{ section: DataSectionId; row?: Row; viewOnly?: boolean } | null>(null);
  const [loadContractOpen, setLoadContractOpen] = useState(false);
  const [viewContractRow, setViewContractRow] = useState<Row | null>(null);
  const [deleteContractCandidate, setDeleteContractCandidate] = useState<Row | null>(null);
  const [appMessageDialog, setAppMessageDialog] = useState<AppMessageDialogState | null>(null);
  const [data, setData] = useState<Record<TableName, Row[]>>({
    companies: [],
    customers: [],
    customer_managers: [],
    ports: [],
    products: [],
    contract_terms: [],
    term_configurations: [],
    term_configuration_items: [],
    contracts: [],
  });
  const [contract, setContract] = useState<ContractDraft>({
    contract_no: "",
    issue_date: today,
    buyer_id: "",
    seller_id: "",
    customer_manager_id: "",
    product_id: "",
    term_configuration_id: "",
    quantity: "0",
    unit_price: "0",
    advance_amount: "0",
    destination_port: "",
    loading_port: "",
    trade_terms: "",
    expiry_date: today,
    pi_expiry_date: today,
    palletized: "",
    drum_count: "0",
    purchase_no: "",
    purchase_no_touched: "no",
  });

  const totalAmount = useMemo(
    () => Number(contract.quantity || 0) * Number(contract.unit_price || 0),
    [contract.quantity, contract.unit_price],
  );
  const advanceAmount = useMemo(() => Number(contract.advance_amount || 0), [contract.advance_amount]);
  const balanceAmount = totalAmount - advanceAmount;

  useEffect(() => {
    void prepareLoginWindow().catch(console.error);
    void checkForAppUpdate(() =>
      showConfirm("检测到新版本，是否立即下载并安装？如果取消，应用将自动关闭。", {
        title: "发现新版本",
        confirmText: "下载并安装",
        cancelText: "关闭应用",
        tone: "warning",
      }),
    );
  }, []);

  useEffect(() => {
    return installDesktopShortcutGuards();
  }, []);

  async function handleLogin() {
    setLoginError("");
    setLoginChecking(true);
    try {
      const result = await verifyLoginCredential(loginCredential);
      if (result.status === "valid") {
        setLoginCredential("");
        setAuthState("loadingApp");
        setLoginChecking(false);
        await prepareMainWindow();
        await refreshAll();
        setAuthState("signedIn");
        return;
      }
      setLoginError(result.message);
    } catch (error) {
      setAuthState("signedOut");
      setLoginError(`登录或加载失败：${String(error)}`);
    } finally {
      setLoginChecking(false);
    }
  }

  async function refreshAll() {
    const tables: TableName[] = [
      "customers",
      "customer_managers",
      "companies",
      "products",
      "ports",
      "contract_terms",
      "term_configurations",
      "term_configuration_items",
      "contracts",
    ];
    const rows = await Promise.all(tables.map((table) => api.list(table)));
    setData((current) => {
      const next = { ...current };
      tables.forEach((table, index) => {
        next[table] = rows[index] as Row[];
      });
      return next;
    });
  }

  async function saveRow(section: DataSectionId, values: Row, id?: number) {
    const table = sectionTables[section];
    if (!table) return;
    if (id) {
      await api.update(table, id, normalizePayload(section, values));
    } else {
      await api.create(table, normalizePayload(section, values));
    }
    setModal(null);
    await refreshAll();
  }

  async function deleteRow(section: DataSectionId, id: number) {
    const table = sectionTables[section];
    if (!table) return;
    try {
      await api.deleteMany(table, [id]);
      await refreshAll();
    } catch (error) {
      await showAlert(`删除失败：${String(error)}`, "删除失败", "error");
    }
  }

  async function saveTermConfiguration(values: TermConfigurationFormState, id?: number) {
    const payload = {
      config_no: values.config_no.trim(),
      config_date: today,
    };
    const result = id
      ? await api.update("term_configurations", id, payload)
      : await api.create("term_configurations", payload);
    const configId = id ?? result.id;
    await api.replaceTermConfigurationItems(
      configId,
      values.items.map((item, index) => ({
        item_code: data.contract_terms.find((term) => Number(term.id) === Number(item.term_id))?.term_code || "",
        term_id: Number(item.term_id),
        sort_order: index,
      })),
    );
    setModal(null);
    await refreshAll();
  }

  async function saveCurrentContract() {
    const validationMessage = validateContractDraft(contract);
    if (validationMessage) {
      await showAlert(validationMessage);
      return;
    }
    const payload = contractDraftToPayload(contract, balanceAmount);
    const existing = data.contracts.find((row) => String(row.contract_no || "") === contract.contract_no.trim());
    if (existing?.id) {
      const shouldOverwrite = await showConfirm(`存在重复合同编号${contract.contract_no.trim()}，保存将覆盖原有方案，是否继续保存？`, {
        title: "覆盖确认",
        confirmText: "继续保存",
      });
      if (!shouldOverwrite) return;
      await api.update("contracts", Number(existing.id), payload);
    } else {
      await api.create("contracts", payload);
    }
    await refreshAll();
    await showAlert("单据已保存至历史单据。", "保存成功", "success");
  }

  function loadContractRow(row: Row) {
    setContract(contractRowToDraft(row));
    setLoadContractOpen(false);
    setActiveSection("contract");
  }

  async function deleteContractHistory() {
    if (!deleteContractCandidate) return;
    await api.deleteMany("contracts", [Number(deleteContractCandidate.id)]);
    await refreshAll();
    setDeleteContractCandidate(null);
  }

  async function requirePreview() {
    const preview = buildContractPreviewFromRows(contract, data, totalAmount, advanceAmount, balanceAmount);
    if (!preview) {
      await showAlert("请完整填写合同编号、买方、贸易户头、客户经理和产品。");
    }
    return preview;
  }

  async function generateContract() {
    const preview = await requirePreview();
    if (!preview) return;
    await withLoading(async () => {
      const logoData = preview.seller.logo_data ? await imageSourceToPngDataUrl(preview.seller.logo_data) : "";
      const result = await api.generateContractPdf({
        contractNo: preview.contractNo,
        fields: buildContractExcelFields(preview),
        logoData,
      });
      setGeneratedPath(result.path);
    });
  }

  async function generatePi() {
    const preview = await requirePreview();
    if (!preview) return;
    await withLoading(async () => {
      const logoData = preview.seller.logo_data ? await imageSourceToPngDataUrl(preview.seller.logo_data) : "";
      const result = await api.generatePiPdf({
        contractNo: preview.contractNo,
        fields: buildPiExcelFields(preview),
        logoData,
      });
      setGeneratedPath(result.path);
    });
  }

  async function generatePackingList() {
    const preview = await requirePreview();
    if (!preview) return;
    await withLoading(async () => {
      const logoData = preview.seller.logo_data ? await imageSourceToPngDataUrl(preview.seller.logo_data) : "";
      const result = await api.generatePackingListPdf({ contractNo: preview.contractNo, fields: buildShippingExcelFields(preview), logoData });
      setGeneratedPath(result.path);
    });
  }

  async function generateCommercialInvoice() {
    const preview = await requirePreview();
    if (!preview) return;
    await withLoading(async () => {
      const logoData = preview.seller.logo_data ? await imageSourceToPngDataUrl(preview.seller.logo_data) : "";
      const result = await api.generateCommercialInvoicePdf({ contractNo: preview.contractNo, fields: buildShippingExcelFields(preview), logoData });
      setGeneratedPath(result.path);
    });
  }

  async function withLoading(task: () => Promise<void>) {
    setLoading(true);
    try {
      await task();
    } catch (error) {
      setLoading(false);
      await showAlert(String(error), "操作失败", "error");
    } finally {
      setLoading(false);
    }
  }

  function showAlert(message: string, title = "提示", tone: AppMessageDialogState["tone"] = "info") {
    return new Promise<void>((resolve) => {
      setAppMessageDialog({
        title,
        message,
        tone,
        mode: "alert",
        confirmText: "确定",
        resolve: () => resolve(),
      });
    });
  }

  function showConfirm(
    message: string,
    options: { title?: string; confirmText?: string; cancelText?: string; tone?: AppMessageDialogState["tone"] } = {},
  ) {
    return new Promise<boolean>((resolve) => {
      setAppMessageDialog({
        title: options.title ?? "确认操作",
        message,
        tone: options.tone ?? "warning",
        mode: "confirm",
        confirmText: options.confirmText ?? "确认",
        cancelText: options.cancelText ?? "取消",
        resolve,
      });
    });
  }

  function closeAppMessageDialog(confirmed: boolean) {
    const dialog = appMessageDialog;
    if (!dialog) return;
    setAppMessageDialog(null);
    dialog.resolve(confirmed);
  }

  if (authState === "loadingApp") {
    return (
      <WindowFrame compact>
        <AppLoadingScreen />
      </WindowFrame>
    );
  }

  if (authState !== "signedIn") {
    return (
      <WindowFrame compact>
        <LoginScreen
          checking={loginChecking}
          credential={loginCredential}
          error={loginError}
          onCredentialChange={(value) => {
            setLoginCredential(value.replace(/\D/g, ""));
            setLoginError("");
          }}
          onSubmit={handleLogin}
        />
      </WindowFrame>
    );
  }

  return (
    <WindowFrame>
      <AppAlertContext.Provider value={showAlert}>
        <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/app-logo.png" alt="Auto Contract logo" />
          <div className="brand-copy">
            <strong>外贸单据生成器</strong>
            <span>合同 / PI / 基础资料</span>
          </div>
        </div>
        <nav className="nav-list">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                className={`nav-item${activeSection === section.id ? " active" : ""}`}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={18} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="sidebar-toggle" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </aside>

      <main className="workspace">
        {activeSection === "contract" ? (
          <ContractPanel
            advanceAmount={advanceAmount}
            balanceAmount={balanceAmount}
            contract={contract}
            data={data}
            onChange={setContract}
            onLoadContract={() => setLoadContractOpen(true)}
            onSaveContract={saveCurrentContract}
            onGenerateContract={generateContract}
            onGeneratePi={generatePi}
            onGeneratePackingList={generatePackingList}
            onGenerateCommercialInvoice={generateCommercialInvoice}
            totalAmount={totalAmount}
          />
        ) : activeSection === "customers" ? (
          <CustomerManagementPanel
            rows={data.customers}
            onAdd={() => setModal({ section: "customers" })}
            onDelete={(id) => deleteRow("customers", id)}
            onEdit={(row) => setModal({ section: "customers", row })}
            onView={(row) => setModal({ section: "customers", row, viewOnly: true })}
          />
        ) : activeSection === "customerManagers" ? (
          <CustomerManagerPanel
            rows={data.customer_managers}
            onAdd={() => setModal({ section: "customerManagers" })}
            onDelete={(id) => deleteRow("customerManagers", id)}
            onEdit={(row) => setModal({ section: "customerManagers", row })}
            onView={(row) => setModal({ section: "customerManagers", row, viewOnly: true })}
          />
        ) : activeSection === "products" ? (
          <ProductManagementPanel
            rows={data.products}
            onAdd={() => setModal({ section: "products" })}
            onDelete={(id) => deleteRow("products", id)}
            onEdit={(row) => setModal({ section: "products", row })}
            onView={(row) => setModal({ section: "products", row, viewOnly: true })}
          />
        ) : activeSection === "ports" ? (
          <PortManagementPanel
            rows={data.ports}
            onAdd={() => setModal({ section: "ports" })}
            onDelete={(id) => deleteRow("ports", id)}
            onEdit={(row) => setModal({ section: "ports", row })}
          />
        ) : activeSection === "companies" ? (
          <CompanyManagementPanel
            rows={data.companies}
            onAdd={() => setModal({ section: "companies" })}
            onDelete={(id) => deleteRow("companies", id)}
            onEdit={(row) => setModal({ section: "companies", row })}
            onView={(row) => setModal({ section: "companies", row, viewOnly: true })}
          />
        ) : activeSection === "history" ? (
          <HistoryDocumentsPanel
            contracts={data.contracts}
            customers={data.customers}
            managers={data.customer_managers}
            products={data.products}
            sellers={data.companies}
            onDelete={(row) => setDeleteContractCandidate(row)}
            onView={(row) => setViewContractRow(row)}
          />
        ) : activeSection === "contractTerms" ? (
          <ContractTermsPanel
            configurationItems={data.term_configuration_items}
            configurations={data.term_configurations}
            terms={data.contract_terms}
            onAddTerm={() => setModal({ section: "terms" })}
            onDeleteTerm={(id) => deleteRow("terms", id)}
            onEditTerm={(row) => setModal({ section: "terms", row })}
            onViewTerm={(row) => setModal({ section: "terms", row, viewOnly: true })}
            onAddConfiguration={() => setModal({ section: "termConfigurations" })}
            onDeleteConfiguration={(id) => deleteRow("termConfigurations", id)}
            onEditConfiguration={(row) => setModal({ section: "termConfigurations", row })}
            onViewConfiguration={(row) => setModal({ section: "termConfigurations", row, viewOnly: true })}
          />
        ) : (
          <ManagementPanel
            rows={data[sectionTables[activeSection]]}
            section={activeSection}
            onAdd={() => setModal({ section: activeSection })}
            onDelete={(id) => deleteRow(activeSection, id)}
            onEdit={(row) => setModal({ section: activeSection, row })}
            onView={(row) => setModal({ section: activeSection, row, viewOnly: true })}
          />
        )}
      </main>

      {modal?.section === "customers" ? (
        <CustomerModal
          row={modal.row}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow("customers", values, modal.row?.id)}
        />
      ) : modal?.section === "customerManagers" ? (
        <CustomerManagerModal
          row={modal.row}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow("customerManagers", values, modal.row?.id)}
        />
      ) : modal?.section === "products" ? (
        <ProductModal
          row={modal.row}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow("products", values, modal.row?.id)}
        />
      ) : modal?.section === "ports" ? (
        <PortModal
          row={modal.row}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow("ports", values, modal.row?.id)}
        />
      ) : modal?.section === "companies" ? (
        <CompanyModal
          row={modal.row}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow("companies", values, modal.row?.id)}
        />
      ) : modal?.section === "terms" ? (
        <ContractTermModal
          row={modal.row}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow("terms", values, modal.row?.id)}
        />
      ) : modal?.section === "termConfigurations" ? (
        <TermConfigurationModal
          configuration={modal.row}
          items={
            modal.row
              ? data.term_configuration_items
                  .filter((item) => Number(item.config_id) === Number(modal.row?.id))
                  .sort((left, right) => Number(left.sort_order) - Number(right.sort_order) || Number(left.id) - Number(right.id))
              : []
          }
          terms={data.contract_terms}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveTermConfiguration(values, modal.row?.id)}
        />
      ) : modal ? (
        <EditModal
          fields={fieldDefinitions[modal.section]}
          row={modal.row}
          title={titles[modal.section]}
          viewOnly={modal.viewOnly}
          onClose={() => setModal(null)}
          onSave={(values) => saveRow(modal.section, values, modal.row?.id)}
        />
      ) : null}

      {loadContractOpen ? (
        <LoadContractDialog
          contracts={data.contracts}
          onClose={() => setLoadContractOpen(false)}
          onLoad={loadContractRow}
        />
      ) : null}

      {viewContractRow ? (
        <HistoryDocumentModal
          contract={viewContractRow}
          customers={data.customers}
          managers={data.customer_managers}
          products={data.products}
          sellers={data.companies}
          onClose={() => setViewContractRow(null)}
        />
      ) : null}

      {deleteContractCandidate ? (
        <DeleteHistoryDocumentDialog
          contractNo={String(deleteContractCandidate.contract_no || "该单据")}
          onCancel={() => setDeleteContractCandidate(null)}
          onConfirm={deleteContractHistory}
        />
      ) : null}

      {loading ? (
        <div className="global-loading-backdrop">
          <div className="global-loading-card">
            <div className="global-loading-spinner" />
            <strong>正在生成中...</strong>
          </div>
        </div>
      ) : null}

      {generatedPath ? (
        <div className="modal-backdrop">
          <div className="generated-contract-dialog">
            <div className="modal-header">
              <div>
                <h2>导出成功</h2>
                <span>文件已生成</span>
              </div>
              <button className="modal-close-button" onClick={() => setGeneratedPath("")}>
                <X size={20} />
              </button>
            </div>
            <div className="generated-contract-body">
              <span>文件存放路径</span>
              <strong>{generatedPath}</strong>
            </div>
            <div className="modal-footer generated-contract-actions">
              <button className="secondary-button" onClick={() => setGeneratedPath("")}>
                关闭
              </button>
              <button className="primary-button" onClick={() => api.openGeneratedContract(generatedPath)}>
                打开文件
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {appMessageDialog ? (
        <AppMessageDialog
          dialog={appMessageDialog}
          onCancel={() => closeAppMessageDialog(false)}
          onConfirm={() => closeAppMessageDialog(true)}
        />
      ) : null}
        </div>
      </AppAlertContext.Provider>
    </WindowFrame>
  );
}

function WindowFrame({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={`window-frame${compact ? " compact" : ""}`}>{children}</div>;
}

async function prepareLoginWindow() {
  if (!isTauriRuntime) return;
  const window = getCurrentWindow();
  await window.setResizable(false);
  await window.setMaximizable(false);
  await window.setMinimizable(false);
  await window.setMinSize(LOGIN_WINDOW_SIZE);
  await window.setSize(LOGIN_WINDOW_SIZE);
  await window.center();
}

async function prepareMainWindow() {
  if (!isTauriRuntime) return;
  const window = getCurrentWindow();
  await window.setResizable(true);
  await window.setMaximizable(true);
  await window.setMinimizable(true);
  await window.setMinSize(MAIN_WINDOW_MIN_SIZE);
  await window.setSize(MAIN_WINDOW_SIZE);
  await window.center();
}

function AppLoadingScreen() {
  return (
    <main className="app-loading-shell" aria-live="polite" aria-busy="true">
      <div className="app-loading-panel">
        <img className="app-loading-logo" src="/app-logo.png" alt="Auto Contract logo" />
        <div>
          <span>Auto Contract</span>
          <h1>Loading</h1>
        </div>
      </div>
    </main>
  );
}

function LoginScreen({
  checking,
  credential,
  error,
  onCredentialChange,
  onSubmit,
}: {
  checking: boolean;
  credential: string;
  error: string;
  onCredentialChange: (value: string) => void;
  onSubmit: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checking) {
      onSubmit();
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-mark">
          <img src="/app-logo.png" alt="Auto Contract logo" />
        </div>
        <div className="login-heading">
          <span>Auto Contract</span>
          <h1>登录凭证</h1>
        </div>
        <label className="login-field">
          <span>请输入数字凭证</span>
          <input
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="例如 20260715"
            value={credential}
            onChange={(event) => onCredentialChange(event.target.value)}
          />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button className="login-button" disabled={checking || !credential.trim()} type="submit">
          <LogIn size={18} />
          <span>{checking ? "正在校验" : "登录"}</span>
        </button>
      </form>
    </main>
  );
}

async function verifyLoginCredential(input: string): Promise<LoginVerificationResult> {
  const credential = input.trim();
  if (!/^\d+$/.test(credential)) {
    return { status: "invalid", message: "Login credential must be numeric." };
  }

  const response = await fetch(LOGIN_VERIFY_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as LoginVerificationResponse;
  if (payload.valid) {
    return { status: "valid" };
  }

  return {
    status: "invalid",
    message: payload.message || "Login credential is invalid.",
  };
}
function AppMessageDialog({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: AppMessageDialogState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isConfirm = dialog.mode === "confirm";
  const Icon = dialog.tone === "success" ? CircleCheck : dialog.tone === "info" ? Info : AlertTriangle;

  return (
    <div className="modal-backdrop app-message-backdrop">
      <div className={`app-message-card ${dialog.tone}`} role={isConfirm ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="app-message-title">
        <div className="app-message-body">
          <span className="app-message-icon">
            <Icon size={25} />
          </span>
          <div>
            <h2 id="app-message-title">{dialog.title}</h2>
            <p>{dialog.message}</p>
          </div>
        </div>
        <div className="app-message-footer">
          {isConfirm ? (
            <button className="secondary-button" onClick={onCancel}>
              {dialog.cancelText ?? "取消"}
            </button>
          ) : null}
          <button className={dialog.tone === "error" || dialog.tone === "warning" ? "danger-confirm-button" : "primary-button"} onClick={onConfirm}>
            {dialog.confirmText ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContractPanel({
  advanceAmount,
  balanceAmount,
  contract,
  data,
  onChange,
  onLoadContract,
  onSaveContract,
  onGenerateContract,
  onGeneratePi,
  onGeneratePackingList,
  onGenerateCommercialInvoice,
  totalAmount,
}: {
  advanceAmount: number;
  balanceAmount: number;
  contract: ContractDraft;
  data: Record<TableName, Row[]>;
  onChange: (value: ContractDraft) => void;
  onLoadContract: () => void;
  onSaveContract: () => void;
  onGenerateContract: () => void;
  onGeneratePi: () => void;
  onGeneratePackingList: () => void;
  onGenerateCommercialInvoice: () => void;
  totalAmount: number;
}) {
  const update = (field: keyof ContractDraft, value: string) => {
    if (field === "contract_no") {
      onChange({
        ...contract,
        contract_no: value,
        purchase_no: contract.purchase_no_touched === "yes" ? contract.purchase_no : value,
      });
      return;
    }
    if (field === "purchase_no") {
      onChange({ ...contract, purchase_no: value, purchase_no_touched: "yes" });
      return;
    }
    onChange({ ...contract, [field]: value });
  };
  const portOptions = data.ports.map((row) => row.name_en).filter(Boolean);

  return (
    <div className="document-generation-page">
      <header className="page-header">
        <div>
          <h1>单据生成</h1>
          <p>录入单据字段，系统自动核算金额、重量和体积，并根据模板导出合同、PI、箱单或发票 PDF。</p>
        </div>
        <div className="header-actions export-actions">
          <button className="secondary-button icon-button-text" onClick={onSaveContract}>
            <Save size={16} />
            保存单据
          </button>
          <button className="secondary-button icon-button-text" onClick={onLoadContract}>
            <FileSpreadsheet size={16} />
            读取单据
          </button>
          <div className="export-menu">
            <Button className="document-action primary-document-action export-trigger">
              <FileSpreadsheet />
              导出
              <ChevronDown size={15} />
            </Button>
            <div className="export-menu-list" role="menu" aria-label="导出 PDF">
              <button onClick={onGenerateContract} role="menuitem">
                <FileSpreadsheet size={16} />
                <span>合同</span>
                <em>Contract</em>
              </button>
              <button onClick={onGeneratePi} role="menuitem">
                <ScrollText size={16} />
                <span>PI</span>
                <em>Proforma Invoice</em>
              </button>
              <button onClick={onGeneratePackingList} role="menuitem">
                <Package size={16} />
                <span>PL</span>
                <em>Packing List</em>
              </button>
              <button onClick={onGenerateCommercialInvoice} role="menuitem">
                <Building2 size={16} />
                <span>CI</span>
                <em>Commercial Invoice</em>
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="content-grid">
        <div className="panel form-panel">
          <div className="panel-heading">
            <span className="panel-heading-icon"><FileSpreadsheet size={18} /></span>
            <div><h2>合同信息</h2><p>交易主体、产品、金额及运输条件</p></div>
          </div>
          <div className="form-grid">
            <Field label="合同编码" value={contract.contract_no} onChange={(value) => update("contract_no", value)} />
            <Field label="签订日期" type="date" value={contract.issue_date} onChange={(value) => update("issue_date", value)} />
            <SelectField label="买方信息" rows={data.customers} value={contract.buyer_id} labelKey="company_name_en" onChange={(value) => update("buyer_id", value)} />
            <SelectField label="贸易户头" rows={data.companies} value={contract.seller_id} labelKey="company_name_cn" fallbackKey="company_name_en" onChange={(value) => update("seller_id", value)} />
            <SelectField label="客户经理" rows={data.customer_managers} value={contract.customer_manager_id} labelKey="name" onChange={(value) => update("customer_manager_id", value)} />
            <SelectField label="产品信息" rows={data.products} value={contract.product_id} labelKey="name_en" onChange={(value) => update("product_id", value)} />
            <SelectField label="合同条款配置" rows={data.term_configurations} value={contract.term_configuration_id} labelKey="config_no" onChange={(value) => update("term_configuration_id", value)} />
            <Field label="产品数量" type="number" value={contract.quantity} onChange={(value) => update("quantity", value)} />
            <Field label="单价" type="number" value={contract.unit_price} onChange={(value) => update("unit_price", value)} />
            <Field label="预付款" type="number" value={contract.advance_amount} onChange={(value) => update("advance_amount", value)} />
            <Field label="付款日期" type="date" value={contract.expiry_date} onChange={(value) => update("expiry_date", value)} />
            <Field label="PI有效期" type="date" value={contract.pi_expiry_date} onChange={(value) => update("pi_expiry_date", value)} />
            <ChoiceField label="是否打托" value={contract.palletized} options={[["no", "否"], ["yes", "是"]]} onChange={(value) => update("palletized", value as ContractDraft["palletized"])} />
            <ChoiceField label="贸易条款" value={contract.trade_terms} options={[["FOB", "FOB"], ["CIF", "CIF"], ["CFR", "CFR"]]} onChange={(value) => update("trade_terms", value as ContractDraft["trade_terms"])} />
            <TextSelectField label="装运港" options={portOptions} value={contract.loading_port} onChange={(value) => update("loading_port", value)} />
            <TextSelectField label="目的港" options={portOptions} value={contract.destination_port} onChange={(value) => update("destination_port", value)} />
          </div>
        </div>

        <div className="panel summary-panel">
          <div className="summary-section">
            <div className="panel-heading summary-heading">
              <span className="panel-heading-icon"><ListChecks size={18} /></span>
              <div><h2>金额核算</h2><p>根据数量与单价自动计算</p></div>
            </div>
            <AmountWords label="总金额" amount={`USD ${formatMoney(totalAmount)}`} english={toEnglishDollarWords(totalAmount)} chinese={toChineseDollarWords(totalAmount)} />
            <AmountWords label="预付款" amount={`USD ${formatMoney(advanceAmount)}`} english={toEnglishDollarWords(advanceAmount)} chinese={toChineseDollarWords(advanceAmount)} />
            <AmountWords label="尾款" amount={`USD ${formatMoney(balanceAmount)}`} english={toEnglishDollarWords(balanceAmount)} chinese={toChineseDollarWords(balanceAmount)} />
          </div>
        </div>
        <div className="panel form-panel">
          <div className="panel-heading">
            <span className="panel-heading-icon"><Package size={18} /></span>
            <div><h2>箱单 / 发票信息</h2><p>包装数量、重量及体积自动换算</p></div>
          </div>
          <div className="form-grid">
            <Field label="PO No." value={contract.purchase_no} onChange={(value) => update("purchase_no", value)} />
            <Field label="装桶数量" type="number" value={contract.drum_count} onChange={(value) => update("drum_count", value)} />
            <Field label="单桶净重（KG）" value={String(Number(data.products.find((row) => Number(row.id) === Number(contract.product_id))?.kgs_per_drum) || 0)} readOnly />
            <Field label="总净重（KG）" value={formatQuantity((Number(data.products.find((row) => Number(row.id) === Number(contract.product_id))?.kgs_per_drum) || 0) * (Number(contract.drum_count) || 0))} readOnly />
            <Field label="单桶毛重（KG）" value={String((Number(data.products.find((row) => Number(row.id) === Number(contract.product_id))?.kgs_per_drum) || 0) + 18)} readOnly />
            <Field label="总毛重（KG）" value={formatQuantity(((Number(data.products.find((row) => Number(row.id) === Number(contract.product_id))?.kgs_per_drum) || 0) + 18) * (Number(contract.drum_count) || 0))} readOnly />
            <Field label="单桶尺寸（CBM）" value="0.24" readOnly />
            <Field label="总尺寸（CBM）" value={formatQuantity(0.24 * (Number(contract.drum_count) || 0))} readOnly />
          </div>
        </div>
      </section>
    </div>
  );
}

function HistoryDocumentsPanel({
  contracts,
  customers,
  managers,
  onDelete,
  onView,
  products,
  sellers,
}: {
  contracts: Row[];
  customers: Row[];
  managers: Row[];
  onDelete: (row: Row) => void;
  onView: (row: Row) => void;
  products: Row[];
  sellers: Row[];
}) {
  return (
    <div className="customer-management-page history-documents-page">
      <header className="page-header">
        <div>
          <h1>历史单据</h1>
          <p>查看已保存的合同单据信息，并可按合同编号读取回单据生成界面。</p>
        </div>
      </header>
      <section className="panel table-panel customer-table-panel history-table-panel">
        <div className="customer-table-scroll">
          <table className="customer-table history-documents-table">
            <colgroup>
              <col className="history-col-contract" />
              <col className="history-col-manager" />
              <col className="history-col-product" />
              <col className="history-col-seller" />
              <col className="history-col-price" />
              <col className="history-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>合同编号</th>
                <th>客户经理</th>
                <th>产品</th>
                <th>贸易户头</th>
                <th>单价</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    <div className="empty-state">
                      <FileSpreadsheet size={28} />
                      <strong>暂无历史单据</strong>
                      <span>在单据生成界面点击“保存单据”后会显示在这里</span>
                    </div>
                  </td>
                </tr>
              ) : (
                contracts.map((row) => (
                  <tr key={row.id}>
                    <td className="history-strong-cell" title={String(row.contract_no || "")}>{row.contract_no || "-"}</td>
                    <td>{findNameById(managers, row.customer_manager_id, "name")}</td>
                    <td className="history-ellipsis-cell" title={findNameById(products, row.product_id, "name_en", "name_cn")}>
                      {findNameById(products, row.product_id, "name_en", "name_cn")}
                    </td>
                    <td className="history-ellipsis-cell" title={findNameById(sellers, row.seller_id, "company_name_cn", "company_name_en")}>
                      {findNameById(sellers, row.seller_id, "company_name_cn", "company_name_en")}
                    </td>
                    <td>{formatMoney(Number(row.unit_price || 0))}</td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onView(row)} title="查看" aria-label="查看">
                          <Eye size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => onDelete(row)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="customer-table-footer">
          <span>
            显示 <strong>{contracts.length ? 1 : 0}</strong> 至 <strong>{contracts.length}</strong>，共 <strong>{contracts.length}</strong> 条
          </span>
          <div className="customer-pagination" aria-label="历史单据分页">
            <button disabled aria-label="上一页">‹</button>
            <button className="active">1</button>
            <button disabled aria-label="下一页">›</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LoadContractDialog({ contracts, onClose, onLoad }: { contracts: Row[]; onClose: () => void; onLoad: (row: Row) => void }) {
  const [selectedId, setSelectedId] = useState(() => String(contracts[0]?.id ?? ""));
  const selected = contracts.find((row) => String(row.id) === selectedId);

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card history-load-modal">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">读取单据</h2>
            <span>选择历史合同编号</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="customer-form-layout">
          <label className="field">
            <span>合同编号</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {contracts.length === 0 ? <option value="">暂无历史单据</option> : null}
              {contracts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.contract_no || `历史单据 #${row.id}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-footer customer-edit-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!selected} onClick={() => selected && onLoad(selected)}>
            读取
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryDocumentModal({
  contract,
  customers,
  managers,
  onClose,
  products,
  sellers,
}: {
  contract: Row;
  customers: Row[];
  managers: Row[];
  onClose: () => void;
  products: Row[];
  sellers: Row[];
}) {
  const product = products.find((row) => Number(row.id) === Number(contract.product_id));
  const drumCount = Number(contract.drum_count) || 0;
  const netWeightPerDrum = Number(product?.kgs_per_drum) || 0;
  const grossWeightPerDrum = netWeightPerDrum + 18;

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card history-document-modal">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">查看历史单据</h2>
            <span>{contract.contract_no || "历史单据"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="customer-detail-layout">
          <section className="customer-info-card">
            <div className="customer-info-grid">
              <CustomerInfoItem label="合同编号" value={contract.contract_no} />
              <CustomerInfoItem label="签订日期" value={contract.issue_date} />
              <CustomerInfoItem label="买方信息" value={findNameById(customers, contract.buyer_id, "company_name_en", "company_name_cn")} />
              <CustomerInfoItem label="贸易户头" value={findNameById(sellers, contract.seller_id, "company_name_cn", "company_name_en")} />
              <CustomerInfoItem label="客户经理" value={findNameById(managers, contract.customer_manager_id, "name")} />
              <CustomerInfoItem label="产品" value={findNameById(products, contract.product_id, "name_en", "name_cn")} />
              <CustomerInfoItem label="单价" value={formatMoney(Number(contract.unit_price || 0))} />
              <CustomerInfoItem label="数量" value={contract.quantity} />
              <CustomerInfoItem label="预付款" value={formatMoney(Number(contract.advance_amount || 0))} />
              <CustomerInfoItem label="尾款" value={formatMoney(Number(contract.balance_amount || 0))} />
              <CustomerInfoItem label="装运港" value={contract.loading_port} />
              <CustomerInfoItem label="目的港" value={contract.destination_port} />
            </div>
          </section>
          <section className="customer-info-card">
            <div className="customer-info-grid">
              <CustomerInfoItem label="PO No." value={contract.purchase_no} />
              <CustomerInfoItem label="装桶数量" value={contract.drum_count} />
              <CustomerInfoItem label="单桶净重（KG）" value={netWeightPerDrum || "-"} />
              <CustomerInfoItem label="总净重（KG）" value={formatQuantity(netWeightPerDrum * drumCount)} />
              <CustomerInfoItem label="单桶毛重（KG）" value={grossWeightPerDrum || "-"} />
              <CustomerInfoItem label="总毛重（KG）" value={formatQuantity(grossWeightPerDrum * drumCount)} />
              <CustomerInfoItem label="单桶尺寸（CBM）" value="0.24" />
              <CustomerInfoItem label="总尺寸（CBM）" value={formatQuantity(0.24 * drumCount)} />
            </div>
          </section>
          <div className="modal-footer customer-view-footer">
            <button className="primary-button" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteHistoryDocumentDialog({ contractNo, onCancel, onConfirm }: { contractNo: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-history-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-history-title">删除确认</h2>
            <p>确定要删除该历史单据吗？此操作无法撤销。</p>
            <strong>{contractNo}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function CustomerManagerPanel({
  onAdd,
  onDelete,
  onEdit,
  onView,
  rows,
}: {
  onAdd: () => void;
  onDelete: (id: number) => void;
  onEdit: (row: Row) => void;
  onView: (row: Row) => void;
  rows: Row[];
}) {
  const [deleteCandidate, setDeleteCandidate] = useState<Row | null>(null);

  function confirmDelete() {
    if (!deleteCandidate) return;
    onDelete(Number(deleteCandidate.id));
    setDeleteCandidate(null);
  }

  return (
    <div className="customer-management-page manager-management-page">
      <header className="page-header">
        <div>
          <h1>客户经理</h1>
          <p>维护客户经理联系方式，支持查看、编辑和删除。</p>
        </div>
        <button className="primary-button icon-button-text" onClick={onAdd}>
          <Plus size={17} />
          新增
        </button>
      </header>
      <section className="panel table-panel customer-table-panel manager-table-panel">
        <div className="customer-table-scroll">
          <table className="customer-table manager-management-table">
            <colgroup>
              <col className="manager-col-name" />
              <col className="manager-col-phone" />
              <col className="manager-col-email" />
              <col className="manager-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>姓名</th>
                <th>电话</th>
                <th>邮箱</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={4}>
                    <div className="empty-state">
                      <UserCog size={28} />
                      <strong>暂无客户经理数据</strong>
                      <span>点击右上角“新增”录入第一位客户经理</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="manager-name-cell">
                      <strong>{row.name || "-"}</strong>
                    </td>
                    <td>{row.phone || "-"}</td>
                    <td>
                      {row.email ? (
                        <span className="customer-email-text" title={String(row.email)}>
                          {row.email}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onView(row)} title="查看" aria-label="查看">
                          <Eye size={16} />
                        </button>
                        <button className="table-action-button icon-only-action" onClick={() => onEdit(row)} title="编辑" aria-label="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteCandidate(row)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="customer-table-footer">
          <span>
            显示 <strong>{rows.length ? 1 : 0}</strong> 至 <strong>{rows.length}</strong>，共 <strong>{rows.length}</strong> 条
          </span>
          <div className="customer-pagination" aria-label="客户经理分页">
            <button disabled aria-label="上一页">‹</button>
            <button className="active">1</button>
            <button disabled aria-label="下一页">›</button>
          </div>
        </div>
      </section>
      {deleteCandidate ? (
        <DeleteManagerDialog
          managerName={String(deleteCandidate.name || "该客户经理")}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function DeleteManagerDialog({
  managerName,
  onCancel,
  onConfirm,
}: {
  managerName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-manager-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-manager-title">删除确认</h2>
            <p>确定要删除该客户经理信息吗？此操作无法撤销。</p>
            <strong>{managerName}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function ProductManagementPanel({
  onAdd,
  onDelete,
  onEdit,
  onView,
  rows,
}: {
  onAdd: () => void;
  onDelete: (id: number) => void;
  onEdit: (row: Row) => void;
  onView: (row: Row) => void;
  rows: Row[];
}) {
  const [deleteCandidate, setDeleteCandidate] = useState<Row | null>(null);

  function confirmDelete() {
    if (!deleteCandidate) return;
    onDelete(Number(deleteCandidate.id));
    setDeleteCandidate(null);
  }

  function formatPackaging(row: Row) {
    if (!row.kgs_per_drum) return "-";
    return `${row.kgs_per_drum} KG/桶`;
  }

  return (
    <div className="customer-management-page product-management-page">
      <header className="page-header">
        <div>
          <h1>产品管理</h1>
          <p>维护产品品名、HScode、纯度、包装规格和 CAS 信息。</p>
        </div>
        <button className="primary-button icon-button-text" onClick={onAdd}>
          <Plus size={17} />
          新增
        </button>
      </header>
      <section className="panel table-panel customer-table-panel product-table-panel">
        <div className="customer-table-scroll">
          <table className="customer-table product-management-table">
            <colgroup>
              <col className="product-col-name" />
              <col className="product-col-hscode" />
              <col className="product-col-purity" />
              <col className="product-col-package" />
              <col className="product-col-cas" />
              <col className="product-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>品名</th>
                <th>HScode</th>
                <th>纯度</th>
                <th>包装规格</th>
                <th>CAS</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={6}>
                    <div className="empty-state">
                      <Package size={28} />
                      <strong>暂无产品数据</strong>
                      <span>点击右上角“新增”录入第一条产品资料</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="product-name-cell">
                      <strong title={String(row.name_en || "")}>{row.name_en || "-"}</strong>
                      <span title={String(row.name_cn || "")}>{row.name_cn || "-"}</span>
                    </td>
                    <td>{row.hs_code || "-"}</td>
                    <td>{row.model || "-"}</td>
                    <td>{formatPackaging(row)}</td>
                    <td>{row.cas || "-"}</td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onView(row)} title="查看" aria-label="查看">
                          <Eye size={16} />
                        </button>
                        <button className="table-action-button icon-only-action" onClick={() => onEdit(row)} title="编辑" aria-label="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteCandidate(row)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="customer-table-footer">
          <span>
            显示 <strong>{rows.length ? 1 : 0}</strong> 至 <strong>{rows.length}</strong>，共 <strong>{rows.length}</strong> 条
          </span>
          <div className="customer-pagination" aria-label="产品分页">
            <button disabled aria-label="上一页">‹</button>
            <button className="active">1</button>
            <button disabled aria-label="下一页">›</button>
          </div>
        </div>
      </section>
      {deleteCandidate ? (
        <DeleteProductDialog
          productName={String(deleteCandidate.name_en || deleteCandidate.name_cn || "该产品")}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function DeleteProductDialog({
  productName,
  onCancel,
  onConfirm,
}: {
  productName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-product-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-product-title">删除确认</h2>
            <p>确定要删除该产品信息吗？此操作无法撤销。</p>
            <strong>{productName}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function PortManagementPanel({
  onAdd,
  onDelete,
  onEdit,
  rows,
}: {
  onAdd: () => void;
  onDelete: (id: number) => void;
  onEdit: (row: Row) => void;
  rows: Row[];
}) {
  const [deleteCandidate, setDeleteCandidate] = useState<Row | null>(null);

  function confirmDelete() {
    if (!deleteCandidate) return;
    onDelete(Number(deleteCandidate.id));
    setDeleteCandidate(null);
  }

  return (
    <div className="customer-management-page port-management-page">
      <header className="page-header">
        <div>
          <h1>港口管理</h1>
          <p>维护装运港和目的港的中英文名称。</p>
        </div>
        <button className="primary-button icon-button-text" onClick={onAdd}>
          <Plus size={17} />
          新增
        </button>
      </header>
      <section className="panel table-panel customer-table-panel port-table-panel">
        <div className="customer-table-scroll">
          <table className="customer-table port-management-table">
            <colgroup>
              <col className="port-col-sequence" />
              <col className="port-col-name-en" />
              <col className="port-col-name-cn" />
              <col className="port-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th className="sequence-cell">序号</th>
                <th>港口名 EN</th>
                <th>港口名 CN</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={4}>
                    <div className="empty-state">
                      <Anchor size={28} />
                      <strong>暂无港口数据</strong>
                      <span>点击右上角“新增”录入第一条港口资料</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="sequence-cell">{index + 1}</td>
                    <td className="port-name-cell" title={String(row.name_en || "")}>{row.name_en || "-"}</td>
                    <td className="port-name-cell" title={String(row.name_cn || "")}>{row.name_cn || "-"}</td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onEdit(row)} title="编辑" aria-label="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteCandidate(row)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="customer-table-footer">
          <span>
            显示 <strong>{rows.length ? 1 : 0}</strong> 至 <strong>{rows.length}</strong>，共 <strong>{rows.length}</strong> 条
          </span>
          <div className="customer-pagination" aria-label="港口分页">
            <button disabled aria-label="上一页">‹</button>
            <button className="active">1</button>
            <button disabled aria-label="下一页">›</button>
          </div>
        </div>
      </section>
      {deleteCandidate ? (
        <DeletePortDialog
          portName={String(deleteCandidate.name_en || deleteCandidate.name_cn || "该港口")}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function DeletePortDialog({
  portName,
  onCancel,
  onConfirm,
}: {
  portName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-port-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-port-title">删除确认</h2>
            <p>确定要删除该港口信息吗？此操作无法撤销。</p>
            <strong>{portName}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function PortModal({
  onClose,
  onSave,
  row,
}: {
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
}) {
  const appAlert = useAppAlert();
  const [form, setForm] = useState<Row>(() => ({
    name_en: row?.name_en ?? "",
    name_cn: row?.name_cn ?? "",
  }));

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!String(form.name_en || "").trim()) {
      appAlert("请填写英文港口名。");
      return;
    }
    onSave(form);
  }

  const title = row ? "编辑港口信息" : "新增港口信息";

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card port-modal-card">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">{title}</h2>
            <span>{form.name_en || "港口资料"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="customer-form-layout port-form-layout">
          <div className="customer-form-grid port-modal-form-grid">
            <Field label="港口名 EN" value={String(form.name_en ?? "")} onChange={(value) => update("name_en", value)} placeholder="请输入英文港口名" required />
            <Field label="港口名 CN" value={String(form.name_cn ?? "")} onChange={(value) => update("name_cn", value)} placeholder="请输入中文港口名" />
          </div>
        </div>
        <div className="modal-footer customer-edit-footer">
          <button className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button icon-button-text" onClick={submit}>
            <Save size={15} />
            保存港口
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyManagementPanel({
  onAdd,
  onDelete,
  onEdit,
  onView,
  rows,
}: {
  onAdd: () => void;
  onDelete: (id: number) => void;
  onEdit: (row: Row) => void;
  onView: (row: Row) => void;
  rows: Row[];
}) {
  const [deleteCandidate, setDeleteCandidate] = useState<Row | null>(null);

  function confirmDelete() {
    if (!deleteCandidate) return;
    onDelete(Number(deleteCandidate.id));
    setDeleteCandidate(null);
  }

  return (
    <div className="customer-management-page company-management-page">
      <header className="page-header">
        <div>
          <h1>贸易户头</h1>
          <p>维护贸易户头、开户行和美元账户信息。</p>
        </div>
        <button className="primary-button icon-button-text" onClick={onAdd}>
          <Plus size={17} />
          新增
        </button>
      </header>
      <section className="panel table-panel customer-table-panel company-table-panel">
        <div className="customer-table-scroll">
          <table className="customer-table company-management-table">
            <colgroup>
              <col className="company-col-name" />
              <col className="company-col-bank" />
              <col className="company-col-account" />
              <col className="company-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>公司名称</th>
                <th>开户行</th>
                <th>美元账户</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={4}>
                    <div className="empty-state">
                      <Building2 size={28} />
                      <strong>暂无贸易户头数据</strong>
                      <span>点击右上角“新增”录入第一条贸易户头资料</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="company-name-cell" title={String(row.company_name_cn || "")}>
                      <strong>{row.company_name_cn || "-"}</strong>
                    </td>
                    <td className="company-bank-cell" title={String(row.bank_name_cn || "")}>
                      {row.bank_name_cn || "-"}
                    </td>
                    <td className="company-account-cell" title={String(row.usd_account || "")}>
                      {row.usd_account || "-"}
                    </td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onView(row)} title="查看" aria-label="查看">
                          <Eye size={16} />
                        </button>
                        <button className="table-action-button icon-only-action" onClick={() => onEdit(row)} title="编辑" aria-label="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteCandidate(row)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="customer-table-footer">
          <span>
            显示 <strong>{rows.length ? 1 : 0}</strong> 至 <strong>{rows.length}</strong>，共 <strong>{rows.length}</strong> 条
          </span>
          <div className="customer-pagination" aria-label="贸易户头分页">
            <button disabled aria-label="上一页">‹</button>
            <button className="active">1</button>
            <button disabled aria-label="下一页">›</button>
          </div>
        </div>
      </section>
      {deleteCandidate ? (
        <DeleteCompanyDialog
          companyName={String(deleteCandidate.company_name_cn || "该贸易户头")}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function DeleteCompanyDialog({
  companyName,
  onCancel,
  onConfirm,
}: {
  companyName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-company-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-company-title">删除确认</h2>
            <p>确定要删除该贸易户头信息吗？此操作无法撤销。</p>
            <strong>{companyName}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function CompanyModal({
  onClose,
  onSave,
  row,
  viewOnly = false,
}: {
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
  viewOnly?: boolean;
}) {
  const appAlert = useAppAlert();
  const [form, setForm] = useState<Row>(() => ({
    company_name_en: row?.company_name_en ?? "",
    company_name_cn: row?.company_name_cn ?? "",
    address: row?.address ?? "",
    bank_name_en: row?.bank_name_en ?? "",
    bank_name_cn: row?.bank_name_cn ?? "",
    swift_code: row?.swift_code ?? "",
    usd_account: row?.usd_account ?? "",
    content: row?.content ?? "",
    logo_data: row?.logo_data ?? "",
  }));

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!String(form.company_name_cn || "").trim()) {
      appAlert("请填写中文公司名称。");
      return;
    }
    onSave(form);
  }

  const title = viewOnly ? "查看贸易户头信息" : row ? "编辑贸易户头信息" : "新增贸易户头信息";

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card company-modal-card">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">
              {viewOnly ? <Building2 size={18} /> : null}
              {title}
            </h2>
            <span>{form.company_name_cn || "贸易户头资料"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {viewOnly ? (
          <div className="customer-detail-layout company-detail-layout">
            <section className="customer-info-card">
              <div className="customer-info-grid">
                <CustomerInfoItem label="公司名称 CN" value={row?.company_name_cn} />
                <CustomerInfoItem label="公司名称 EN" value={row?.company_name_en} />
                <CustomerInfoItem label="开户行 CN" value={row?.bank_name_cn} />
                <CustomerInfoItem label="开户行 EN" value={row?.bank_name_en} />
                <CustomerInfoItem label="SWIFT CODE" value={row?.swift_code} />
                <CustomerInfoItem label="USD ACCOUNT" value={row?.usd_account} />
                <CustomerInfoItem label="地址" value={row?.address} wide />
                <CustomerInfoItem label="备注" value={row?.content} wide />
              </div>
              {row?.logo_data ? <img className="logo-preview company-logo-preview" src={String(row.logo_data)} alt="logo preview" /> : null}
            </section>
            <div className="modal-footer customer-view-footer">
              <button className="primary-button" onClick={onClose}>关闭</button>
            </div>
          </div>
        ) : (
          <>
            <div className="customer-form-layout company-form-layout">
              <div className="customer-form-grid company-modal-form-grid">
                <Field label="公司名称 CN" value={String(form.company_name_cn ?? "")} onChange={(value) => update("company_name_cn", value)} placeholder="请输入中文公司名称" required />
                <Field label="公司名称 EN" value={String(form.company_name_en ?? "")} onChange={(value) => update("company_name_en", value)} placeholder="请输入英文公司名称" />
                <Field label="开户行 CN" value={String(form.bank_name_cn ?? "")} onChange={(value) => update("bank_name_cn", value)} placeholder="请输入中文开户行" />
                <Field label="开户行 EN" value={String(form.bank_name_en ?? "")} onChange={(value) => update("bank_name_en", value)} placeholder="请输入英文开户行" />
                <Field label="SWIFT CODE" value={String(form.swift_code ?? "")} onChange={(value) => update("swift_code", value)} placeholder="请输入 SWIFT CODE" />
                <Field label="USD ACCOUNT" value={String(form.usd_account ?? "")} onChange={(value) => update("usd_account", value)} placeholder="请输入美元账户" />
                <TextAreaField label="地址" value={String(form.address ?? "")} onChange={(value) => update("address", value)} placeholder="请输入公司地址" />
                <TextAreaField label="备注" value={String(form.content ?? "")} onChange={(value) => update("content", value)} placeholder="请输入备注" />
                <LogoField value={String(form.logo_data ?? "")} onChange={(value) => update("logo_data", value)} />
              </div>
            </div>
            <div className="modal-footer customer-edit-footer">
              <button className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button icon-button-text" onClick={submit}>
                <Save size={15} />
                保存贸易户头
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProductModal({
  onClose,
  onSave,
  row,
  viewOnly = false,
}: {
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
  viewOnly?: boolean;
}) {
  const appAlert = useAppAlert();
  const [form, setForm] = useState<Row>(() => ({
    name_en: row?.name_en ?? "",
    name_cn: row?.name_cn ?? "",
    hs_code: row?.hs_code ?? "",
    model: row?.model ?? "",
    kgs_per_drum: row?.kgs_per_drum ?? "",
    cas: row?.cas ?? "",
    is_drug_precursor: row?.is_drug_precursor ?? 0,
  }));

  function update(key: string, value: string | number) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!String(form.name_en || "").trim()) {
      appAlert("请填写英文品名。");
      return;
    }
    onSave(form);
  }

  const title = viewOnly ? "查看产品信息" : row ? "编辑产品信息" : "新增产品信息";
  const isDrugPrecursor = Number(form.is_drug_precursor) ? "是" : "否";

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card product-modal-card">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">
              {viewOnly ? <Package size={18} /> : null}
              {title}
            </h2>
            <span>{form.name_en || "产品资料"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {viewOnly ? (
          <div className="customer-detail-layout product-detail-layout">
            <section className="customer-info-card">
              <div className="customer-info-grid">
                <CustomerInfoItem label="品名 EN" value={row?.name_en} />
                <CustomerInfoItem label="品名 CN" value={row?.name_cn} />
                <CustomerInfoItem label="HSCODE" value={row?.hs_code} />
                <CustomerInfoItem label="纯度/规格" value={row?.model} />
                <CustomerInfoItem label="装桶规格 KG/桶" value={row?.kgs_per_drum} />
                <CustomerInfoItem label="CAS" value={row?.cas} />
                <CustomerInfoItem label="是否易制毒前体" value={isDrugPrecursor} wide />
              </div>
            </section>
            <div className="modal-footer customer-view-footer">
              <button className="primary-button" onClick={onClose}>关闭</button>
            </div>
          </div>
        ) : (
          <>
            <div className="customer-form-layout product-form-layout">
              <div className="customer-form-grid product-modal-form-grid">
                <Field label="品名 EN" value={String(form.name_en ?? "")} onChange={(value) => update("name_en", value)} placeholder="请输入英文品名" required />
                <Field label="品名 CN" value={String(form.name_cn ?? "")} onChange={(value) => update("name_cn", value)} placeholder="请输入中文品名" />
                <Field label="HSCODE" value={String(form.hs_code ?? "")} onChange={(value) => update("hs_code", value)} placeholder="请输入 HSCODE" />
                <Field label="纯度/规格" value={String(form.model ?? "")} onChange={(value) => update("model", value)} placeholder="请输入纯度或规格" />
                <Field label="装桶规格 KG/桶" type="number" value={String(form.kgs_per_drum ?? "")} onChange={(value) => update("kgs_per_drum", value)} placeholder="请输入单桶净重" />
                <Field label="CAS" value={String(form.cas ?? "")} onChange={(value) => update("cas", value)} placeholder="请输入 CAS" />
                <label className="field product-precursor-field">
                  <span>是否易制毒前体</span>
                  <div className="checkbox-options">
                    <label>
                      <input type="checkbox" checked={!Number(form.is_drug_precursor)} onChange={() => update("is_drug_precursor", 0)} />
                      否
                    </label>
                    <label>
                      <input type="checkbox" checked={Boolean(Number(form.is_drug_precursor))} onChange={() => update("is_drug_precursor", 1)} />
                      是
                    </label>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer customer-edit-footer">
              <button className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button icon-button-text" onClick={submit}>
                <Save size={15} />
                保存产品
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CustomerManagerModal({
  onClose,
  onSave,
  row,
  viewOnly = false,
}: {
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
  viewOnly?: boolean;
}) {
  const appAlert = useAppAlert();
  const [form, setForm] = useState<Row>(() => ({
    name: row?.name ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
  }));

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!String(form.name || "").trim()) {
      appAlert("请填写客户经理姓名。");
      return;
    }
    onSave(form);
  }

  const title = viewOnly ? "查看客户经理信息" : row ? "编辑客户经理信息" : "新增客户经理信息";

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card manager-modal-card">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">
              {viewOnly ? <UserCog size={18} /> : null}
              {title}
            </h2>
            <span>{form.name || "客户经理资料"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {viewOnly ? (
          <div className="customer-detail-layout manager-detail-layout">
            <section className="customer-info-card">
              <div className="customer-info-grid">
                <CustomerInfoItem label="姓名" value={row?.name} />
                <CustomerInfoItem label="电话" value={row?.phone} />
                <CustomerInfoItem label="邮箱" value={row?.email} wide />
              </div>
            </section>
            <div className="modal-footer customer-view-footer">
              <button className="primary-button" onClick={onClose}>关闭</button>
            </div>
          </div>
        ) : (
          <>
            <div className="customer-form-layout manager-form-layout">
              <div className="customer-form-grid manager-modal-form-grid">
                <Field label="姓名" value={String(form.name ?? "")} onChange={(value) => update("name", value)} placeholder="请输入客户经理姓名" required />
                <Field label="电话" value={String(form.phone ?? "")} onChange={(value) => update("phone", value)} placeholder="请输入联系电话" />
                <Field label="邮箱" value={String(form.email ?? "")} onChange={(value) => update("email", value)} placeholder="name@company.com" />
              </div>
            </div>
            <div className="modal-footer customer-edit-footer">
              <button className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button icon-button-text" onClick={submit}>
                <Save size={15} />
                保存客户经理
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CustomerManagementPanel({
  onAdd,
  onDelete,
  onEdit,
  onView,
  rows,
}: {
  onAdd: () => void;
  onDelete: (id: number) => void;
  onEdit: (row: Row) => void;
  onView: (row: Row) => void;
  rows: Row[];
}) {
  const [deleteCandidate, setDeleteCandidate] = useState<Row | null>(null);

  function confirmDelete() {
    if (!deleteCandidate) return;
    onDelete(Number(deleteCandidate.id));
    setDeleteCandidate(null);
  }

  return (
    <div className="customer-management-page">
      <header className="page-header">
        <div>
          <h1>客户管理</h1>
          <p>维护买方客户资料、客户性质、国家及合同输出所需信息。</p>
        </div>
        <button className="primary-button icon-button-text" onClick={onAdd}>
          <Plus size={17} />
          新增
        </button>
      </header>
      <section className="panel table-panel customer-table-panel">
        <div className="customer-table-scroll">
          <table className="customer-table">
            <colgroup>
              <col className="customer-col-name" />
              <col className="customer-col-type" />
              <col className="customer-col-country" />
              <col className="customer-col-email" />
              <col className="customer-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>公司名称</th>
                <th>性质</th>
                <th>国家</th>
                <th>邮箱</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={5}>
                    <div className="empty-state">
                      <Users size={28} />
                      <strong>暂无客户数据</strong>
                      <span>点击右上角“新增”录入第一条客户资料</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="customer-name-cell">
                      <strong>{row.company_name_en || "-"}</strong>
                    </td>
                    <td>
                      <span className="customer-type-chip">{row.customer_type || "终端客户"}</span>
                    </td>
                    <td>{row.country_cn || row.country || "-"}</td>
                    <td>
                      {row.email ? (
                        <span className="customer-email-text" title={row.email}>
                          {row.email}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onView(row)} title="查看" aria-label="查看">
                          <Eye size={16} />
                        </button>
                        <button className="table-action-button icon-only-action" onClick={() => onEdit(row)} title="编辑" aria-label="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteCandidate(row)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="customer-table-footer">
          <span>
            显示 <strong>{rows.length ? 1 : 0}</strong> 至 <strong>{rows.length}</strong>，共 <strong>{rows.length}</strong> 条
          </span>
          <div className="customer-pagination" aria-label="客户分页">
            <button disabled aria-label="上一页">‹</button>
            <button className="active">1</button>
            <button disabled aria-label="下一页">›</button>
          </div>
        </div>
      </section>
      {deleteCandidate ? (
        <DeleteCustomerDialog
          customerName={deleteCandidate.company_name_en || deleteCandidate.company_name_cn || "该客户"}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function CustomerModal({
  onClose,
  onSave,
  row,
  viewOnly = false,
}: {
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
  viewOnly?: boolean;
}) {
  const appAlert = useAppAlert();
  const [form, setForm] = useState<Row>(() => ({
    company_name_en: row?.company_name_en ?? "",
    company_name_cn: row?.company_name_cn ?? "",
    customer_type: row?.customer_type ?? "终端客户",
    country_cn: row?.country_cn ?? "",
    country: row?.country ?? "",
    email: row?.email ?? "",
    contact_person: row?.contact_person ?? "",
    phone: row?.phone ?? "",
    ntn: row?.ntn ?? "",
    address: row?.address ?? "",
  }));

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!String(form.company_name_en || "").trim()) {
      appAlert("请填写公司名称。");
      return;
    }
    onSave({
      ...form,
      customer_type: form.customer_type || "终端客户",
    });
  }

  const title = viewOnly ? "查看客户信息" : row ? "编辑客户信息" : "新增客户信息";

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">
              {viewOnly ? <Users size={18} /> : null}
              {title}
            </h2>
            <span>{form.company_name_en || "客户资料"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {viewOnly ? (
          <div className="customer-detail-layout">
            <section className="customer-info-card">
              <h3><Building2 size={17} />公司信息</h3>
              <div className="customer-info-grid">
                <CustomerInfoItem label="公司名称 EN" value={row?.company_name_en} />
                <CustomerInfoItem label="公司名称 CN" value={row?.company_name_cn} />
                <CustomerInfoItem label="国家 EN" value={row?.country} />
                <CustomerInfoItem label="国家 CN" value={row?.country_cn || row?.country} />
                <CustomerInfoItem label="性质" value={<span className="customer-type-chip">{row?.customer_type || "终端客户"}</span>} />
                <CustomerInfoItem label="NTN / Tax ID" value={row?.ntn} />
              </div>
            </section>
            <section className="customer-info-card">
              <h3><ScrollText size={17} />联系信息</h3>
              <div className="customer-info-grid">
                <CustomerInfoItem label="联系人" value={formatCustomerContact(row?.contact_person)} />
                <CustomerInfoItem label="电话" value={row?.phone} />
                <CustomerInfoItem label="邮箱" value={row?.email} />
                <CustomerInfoItem label="地址 (Full Address)" value={row?.address} wide />
              </div>
            </section>
            <div className="modal-footer customer-view-footer">
              <button className="primary-button" onClick={onClose}>关闭</button>
            </div>
          </div>
        ) : (
          <>
            <div className="customer-form-layout">
              <div className="customer-form-grid">
                <Field label="公司名称 EN" value={String(form.company_name_en ?? "")} onChange={(value) => update("company_name_en", value)} placeholder="请输入英文公司名称" required />
                <Field label="公司名称 CN" value={String(form.company_name_cn ?? "")} onChange={(value) => update("company_name_cn", value)} placeholder="输入中文公司名称" required />
                <Field label="国家 EN" value={String(form.country ?? "")} onChange={(value) => update("country", value)} placeholder="例如：United States" required />
                <Field label="国家 CN" value={String(form.country_cn ?? "")} onChange={(value) => update("country_cn", value)} placeholder="例如：美国" required />
                <label className="field required-field">
                  <span>性质</span>
                  <select value={String(form.customer_type ?? "终端客户")} onChange={(event) => update("customer_type", event.target.value)}>
                    {customerTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="联系人" value={String(form.contact_person ?? "")} onChange={(value) => update("contact_person", value)} placeholder="联系人姓名" />
                <Field label="邮箱" value={String(form.email ?? "")} onChange={(value) => update("email", value)} placeholder="contact@company.com" />
                <Field label="电话" value={String(form.phone ?? "")} onChange={(value) => update("phone", value)} placeholder="+1 (555) 000-0000" />
                <Field label="NTN / Tax ID" value={String(form.ntn ?? "")} onChange={(value) => update("ntn", value)} placeholder="税号 / NTN" />
                <TextAreaField label="地址 (Full Address)" value={String(form.address ?? "")} onChange={(value) => update("address", value)} placeholder="请输入完整公司地址" />
              </div>
            </div>
            <div className="modal-footer customer-edit-footer">
              <button className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button icon-button-text" onClick={submit}>
                <Save size={15} />
                保存客户
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CustomerInfoItem({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={`customer-info-item${wide ? " wide" : ""}`}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function DeleteCustomerDialog({
  customerName,
  onCancel,
  onConfirm,
}: {
  customerName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-customer-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-customer-title">删除确认</h2>
            <p>确定要删除该客户信息吗？此操作无法撤销，所有相关数据将被永久移除。</p>
            <strong>{customerName}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function ManagementPanel({
  onAdd,
  onDelete,
  onEdit,
  onView,
  rows,
  section,
}: {
  onAdd: () => void;
  onDelete: (id: number) => void;
  onEdit: (row: Row) => void;
  onView: (row: Row) => void;
  rows: Row[];
  section: BasicSectionId;
}) {
  const columns = tableColumns[section];
  const columnLabels = Object.fromEntries(fieldDefinitions[section].map((field) => [field.key, field.label]));
  return (
    <>
      <header className="page-header">
        <div>
          <h1>{titles[section]}</h1>
          <p>维护单据生成所需的基础资料，支持查看、编辑和删除。</p>
        </div>
        <button className="primary-button icon-button-text" onClick={onAdd}>
          <Plus size={17} />
          新增
        </button>
      </header>
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th className="sequence-cell">序号</th>
              {columns.map((column) => (
                <th key={column}>{columnLabels[column] || column}</th>
              ))}
              <th className="action-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={columns.length + 2}>
                  <div className="empty-state">
                    <FileSpreadsheet size={28} />
                    <strong>暂无{titles[section]}数据</strong>
                    <span>点击右上角“新增”录入第一条资料</span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="sequence-cell">{index + 1}</td>
                  {columns.map((column) => (
                    <td key={column}>{String(formatCellValue(row[column]))}</td>
                  ))}
                  <td className="action-cell">
                    <div className="table-actions">
                      <button className="table-action-button" onClick={() => onView(row)}>
                        <Eye size={15} />
                        查看
                      </button>
                      <button className="table-action-button" onClick={() => onEdit(row)}>
                        <Edit3 size={15} />
                        编辑
                      </button>
                      <button className="table-action-button" onClick={() => onDelete(Number(row.id))}>
                        <Trash2 size={15} />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ContractTermModal({
  onClose,
  onSave,
  row,
  viewOnly = false,
}: {
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
  viewOnly?: boolean;
}) {
  const appAlert = useAppAlert();
  const [form, setForm] = useState<Row>(() => ({
    term_code: row?.term_code ?? "",
    content_cn: row?.content_cn ?? "",
    content_en: row?.content_en ?? "",
  }));

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!String(form.term_code || "").trim()) {
      appAlert("请填写条款编码。");
      return;
    }
    if (!String(form.content_cn || "").trim()) {
      appAlert("请填写中文条款。");
      return;
    }
    onSave(form);
  }

  const title = viewOnly ? "查看条款信息" : row ? "编辑条款信息" : "新增条款信息";

  return (
    <div className="modal-backdrop">
      <div className="modal-card customer-modal-card term-modal-card">
        <div className="modal-header">
          <div>
            <h2 className="customer-modal-title">
              {viewOnly ? <ScrollText size={18} /> : null}
              {title}
            </h2>
            <span>{form.term_code || "条款资料"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {viewOnly ? (
          <div className="customer-detail-layout term-detail-layout">
            <section className="customer-info-card">
              <div className="customer-info-grid">
                <CustomerInfoItem label="条款编码" value={row?.term_code} wide />
                <CustomerInfoItem label="中文条款" value={row?.content_cn} wide />
                <CustomerInfoItem label="英文条款" value={row?.content_en} wide />
              </div>
            </section>
            <div className="modal-footer customer-view-footer">
              <button className="primary-button" onClick={onClose}>关闭</button>
            </div>
          </div>
        ) : (
          <>
            <div className="customer-form-layout term-form-layout">
              <div className="customer-form-grid term-modal-form-grid">
                <Field label="条款编码" value={String(form.term_code ?? "")} onChange={(value) => update("term_code", value)} placeholder="请输入条款编码" required />
                <TextAreaField label="中文条款" value={String(form.content_cn ?? "")} onChange={(value) => update("content_cn", value)} placeholder="请输入中文条款" />
                <TextAreaField label="英文条款" value={String(form.content_en ?? "")} onChange={(value) => update("content_en", value)} placeholder="请输入英文条款" />
              </div>
            </div>
            <div className="modal-footer customer-edit-footer">
              <button className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button icon-button-text" onClick={submit}>
                <Save size={15} />
                保存条款
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ContractTermsPanel({
  configurationItems,
  configurations,
  onAddConfiguration,
  onAddTerm,
  onDeleteConfiguration,
  onDeleteTerm,
  onEditConfiguration,
  onEditTerm,
  onViewConfiguration,
  onViewTerm,
  terms,
}: {
  configurationItems: Row[];
  configurations: Row[];
  onAddConfiguration: () => void;
  onAddTerm: () => void;
  onDeleteConfiguration: (id: number) => void;
  onDeleteTerm: (id: number) => void;
  onEditConfiguration: (row: Row) => void;
  onEditTerm: (row: Row) => void;
  onViewConfiguration: (row: Row) => void;
  onViewTerm: (row: Row) => void;
  terms: Row[];
}) {
  const [activeTab, setActiveTab] = useState<TermSectionId>("terms");
  const [deleteTermCandidate, setDeleteTermCandidate] = useState<Row | null>(null);
  const [deleteConfigurationCandidate, setDeleteConfigurationCandidate] = useState<Row | null>(null);
  const isTermsTab = activeTab === "terms";
  const rows = isTermsTab ? terms : configurations;
  const emptyTitle = isTermsTab ? "暂无条款数据" : "暂无配置方案";
  const emptyDescription = isTermsTab ? "先录入常用合同条款，再组合成配置方案。" : "将条款库中的条款组合成可复用的合同配置。";

  function confirmDeleteTerm() {
    if (!deleteTermCandidate) return;
    onDeleteTerm(Number(deleteTermCandidate.id));
    setDeleteTermCandidate(null);
  }

  function confirmDeleteConfiguration() {
    if (!deleteConfigurationCandidate) return;
    onDeleteConfiguration(Number(deleteConfigurationCandidate.id));
    setDeleteConfigurationCandidate(null);
  }

  return (
    <div className="contract-terms-page">
      <header className="page-header">
        <div>
          <h1>合同条款</h1>
          <p>维护条款库，并将常用条款组合为可复用的合同条款配置。</p>
        </div>
        <div className="header-actions contract-term-actions">
          <div className="segmented-tabs" role="tablist" aria-label="合同条款视图">
            <button className={isTermsTab ? "active" : ""} onClick={() => setActiveTab("terms")} role="tab" aria-selected={isTermsTab}>
              条款库
            </button>
            <button className={!isTermsTab ? "active" : ""} onClick={() => setActiveTab("termConfigurations")} role="tab" aria-selected={!isTermsTab}>
              配置方案
            </button>
          </div>
          <button className="primary-button icon-button-text" onClick={isTermsTab ? onAddTerm : onAddConfiguration}>
            <Plus size={17} />
            {isTermsTab ? "新增条款" : "新增配置"}
          </button>
        </div>
      </header>

      <section className="panel table-panel contract-terms-panel">
        {isTermsTab ? (
          <table className="term-table">
            <colgroup>
              <col className="term-col-code" />
              <col className="term-col-content" />
              <col className="term-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>条款编码</th>
                <th>中文条款</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <ContractTermsEmptyState colSpan={3} title={emptyTitle} description={emptyDescription} />
              ) : (
                rows.map((term) => (
                  <tr key={term.id}>
                    <td className="term-code-cell">{term.term_code || "-"}</td>
                    <td>
                      <div className="term-content-clamp">{term.content_cn || "-"}</div>
                    </td>
                    <td className="action-cell">
                      <div className="table-actions icon-table-actions">
                        <button className="table-action-button icon-only-action" onClick={() => onViewTerm(term)} title="查看" aria-label="查看">
                          <Eye size={16} />
                        </button>
                        <button className="table-action-button icon-only-action" onClick={() => onEditTerm(term)} title="编辑" aria-label="编辑">
                          <Edit3 size={16} />
                        </button>
                        <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteTermCandidate(term)} title="删除" aria-label="删除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="term-configuration-table">
            <colgroup>
              <col className="term-config-col-sequence" />
              <col className="term-config-col-rule" />
              <col className="term-config-col-count" />
              <col className="term-config-col-date" />
              <col className="term-config-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th className="sequence-cell">序号</th>
                <th>条款规则</th>
                <th>条款数量</th>
                <th>配置日期</th>
                <th className="action-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <ContractTermsEmptyState colSpan={5} title={emptyTitle} description={emptyDescription} />
              ) : (
                rows.map((configuration, index) => {
                  const itemCount = configurationItems.filter((item) => Number(item.config_id) === Number(configuration.id)).length;
                  return (
                    <tr key={configuration.id}>
                      <td className="sequence-cell">{index + 1}</td>
                      <td>{configuration.config_no || "-"}</td>
                      <td>{itemCount}</td>
                      <td>{configuration.config_date || "-"}</td>
                      <td className="action-cell">
                        <div className="table-actions icon-table-actions">
                          <button className="table-action-button icon-only-action" onClick={() => onViewConfiguration(configuration)} title="查看" aria-label="查看">
                            <Eye size={16} />
                          </button>
                          <button className="table-action-button icon-only-action" onClick={() => onEditConfiguration(configuration)} title="编辑" aria-label="编辑">
                            <Edit3 size={16} />
                          </button>
                          <button className="table-action-button icon-only-action danger-action" onClick={() => setDeleteConfigurationCandidate(configuration)} title="删除" aria-label="删除">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </section>
      {deleteTermCandidate ? (
        <DeleteTermDialog
          termCode={String(deleteTermCandidate.term_code || "该条款")}
          onCancel={() => setDeleteTermCandidate(null)}
          onConfirm={confirmDeleteTerm}
        />
      ) : null}
      {deleteConfigurationCandidate ? (
        <DeleteConfigurationDialog
          configNo={String(deleteConfigurationCandidate.config_no || "该配置方案")}
          onCancel={() => setDeleteConfigurationCandidate(null)}
          onConfirm={confirmDeleteConfiguration}
        />
      ) : null}
    </div>
  );
}

function ContractTermsEmptyState({ colSpan, description, title }: { colSpan: number; description: string; title: string }) {
  return (
    <tr>
      <td className="empty-cell" colSpan={colSpan}>
        <div className="empty-state">
          <ScrollText size={28} />
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </td>
    </tr>
  );
}

function DeleteTermDialog({
  onCancel,
  onConfirm,
  termCode,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  termCode: string;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-term-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-term-title">删除确认</h2>
            <p>删除该条款，将影响已配置的条款方案，是否确认移除？</p>
            <strong>{termCode}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfigurationDialog({
  configNo,
  onCancel,
  onConfirm,
}: {
  configNo: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-configuration-title">
        <div className="delete-confirm-body">
          <span className="delete-confirm-icon"><AlertTriangle size={26} /></span>
          <div>
            <h2 id="delete-configuration-title">删除确认</h2>
            <p>确定要删除该配置方案吗？此操作无法撤销。</p>
            <strong>{configNo}</strong>
          </div>
        </div>
        <div className="delete-confirm-footer">
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="danger-confirm-button" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function TermConfigurationModal({
  configuration,
  items,
  onClose,
  onSave,
  terms,
  viewOnly = false,
}: {
  configuration?: Row;
  items: Row[];
  onClose: () => void;
  onSave: (values: TermConfigurationFormState) => Promise<void>;
  terms: Row[];
  viewOnly?: boolean;
}) {
  const [form, setForm] = useState<TermConfigurationFormState>(() =>
    configuration
      ? {
          config_no: configuration.config_no ?? "",
          config_date: configuration.config_date ?? today,
          items:
            items.length > 0
              ? items.map((item) => ({
                  draft_id: `saved-${item.id}`,
                  term_id: String(item.term_id ?? ""),
                }))
              : [createTermConfigurationDraftItem()],
        }
      : emptyTermConfigurationForm(),
  );
  const [validationMessage, setValidationMessage] = useState("");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const termMap = useMemo(() => new Map(terms.map((term) => [Number(term.id), term])), [terms]);
  const hasDuplicateTerms = hasDuplicateNonEmptyValues(form.items.map((item) => item.term_id));
  const title = viewOnly ? "查看配置方案" : configuration ? "编辑配置方案" : "新增配置方案";

  function updateField(field: "config_no", value: string) {
    setValidationMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectTerm(index: number, termId: string) {
    setValidationMessage("");
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, term_id: termId } : item)),
    }));
  }

  function addItem() {
    if (hasDuplicateTerms) {
      setValidationMessage("存在重复的条款，无法添加新行。");
      return;
    }
    setValidationMessage("");
    setForm((current) => ({ ...current, items: [...current.items, createTermConfigurationDraftItem()] }));
  }

  function removeItem(index: number) {
    setValidationMessage("");
    setForm((current) => ({
      ...current,
      items: current.items.length === 1 ? [createTermConfigurationDraftItem()] : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function moveDraggedItem(sourceItemId: string, targetItemId: string) {
    if (sourceItemId === targetItemId) return;
    setForm((current) => {
      const sourceIndex = current.items.findIndex((item) => item.draft_id === sourceItemId);
      const targetIndex = current.items.findIndex((item) => item.draft_id === targetItemId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const nextItems = [...current.items];
      const [dragged] = nextItems.splice(sourceIndex, 1);
      nextItems.splice(targetIndex, 0, dragged);
      return { ...current, items: nextItems };
    });
  }

  async function submit() {
    if (!form.config_no.trim()) {
      setValidationMessage("请填写条款编号。");
      return;
    }
    if (form.items.some((item) => !item.term_id)) {
      setValidationMessage("请为每一行选择条款。");
      return;
    }
    if (hasDuplicateTerms) {
      setValidationMessage("存在重复的条款，无法保存。");
      return;
    }
    setValidationMessage("");
    await onSave(form);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card configuration-modal-card" role="dialog" aria-modal="true" aria-labelledby="configuration-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="configuration-modal-title">{title}</h2>
            <span>{form.config_no || "新配置方案"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {viewOnly ? (
          <div className="configuration-view">
            <div className="detail-grid configuration-summary">
              <DetailItem label="条款规则" value={configuration?.config_no} />
              <DetailItem label="配置日期" value={configuration?.config_date} />
            </div>
            <div className="configuration-view-items">
              <h3>条款搭配</h3>
              {items.length === 0 ? (
                <div className="configuration-view-row">
                  <strong>-</strong>
                  <p>此配置还没有保存任何条款。</p>
                </div>
              ) : (
                items.map((item) => {
                  const term = termMap.get(Number(item.term_id));
                  return (
                    <div className="configuration-view-row" key={item.id}>
                      <strong>{item.item_code || term?.term_code || "-"}</strong>
                      <p>{term?.content_cn || term?.content_en || "-"}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="configuration-form">
              <div className="configuration-base-fields">
                <Field label="条款规则" value={form.config_no} onChange={(value) => updateField("config_no", value)} />
              </div>
              <div className="configuration-items-header">
                <h3>条款搭配</h3>
                <button className="secondary-button icon-button-text" onClick={addItem}>
                  <Plus size={16} />
                  添加一行
                </button>
              </div>
              <div className="configuration-items">
                {form.items.map((item, index) => {
                  const selectedTerm = termMap.get(Number(item.term_id));
                  return (
                    <div className={`configuration-item-row${draggedItemId === item.draft_id ? " dragging" : ""}`} data-draft-id={item.draft_id} key={item.draft_id}>
                      <span
                        className="drag-handle"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDraggedItemId(item.draft_id);
                        }}
                        onPointerMove={(event) => {
                          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-draft-id]");
                          const targetItemId = target?.dataset.draftId;
                          if (targetItemId) moveDraggedItem(item.draft_id, targetItemId);
                        }}
                        onPointerUp={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                          }
                          setDraggedItemId(null);
                        }}
                        onPointerCancel={() => setDraggedItemId(null)}
                        title="拖拽调整顺序"
                      >
                        <GripVertical size={18} />
                      </span>
                      <span className="configuration-order">第 {index + 1} 条</span>
                      <div className="configuration-code">
                        <span>条款编码</span>
                        <strong>{selectedTerm?.term_code || "选择条款后自动读取"}</strong>
                      </div>
                      <label className="field">
                        <span>选择条款</span>
                        <select value={item.term_id} onChange={(event) => selectTerm(index, event.currentTarget.value)}>
                          <option value="">请选择条款</option>
                          {terms.map((term) => (
                            <option key={term.id} value={term.id} title={String(term.content_cn || term.content_en || "无描述")}>
                              {formatTermOptionLabel(term)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="row-delete-button" onClick={() => removeItem(index)} title="删除该行" aria-label="删除该行">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {validationMessage || hasDuplicateTerms ? (
                <p className="configuration-validation-message" role="alert">
                  {validationMessage || "存在重复的条款，请修改后再添加或保存。"}
                </p>
              ) : null}
            </div>
            <div className="modal-footer">
              <button className="primary-button" onClick={submit}>
                保存
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EditModal({
  fields,
  onClose,
  onSave,
  row,
  title,
  viewOnly = false,
}: {
  fields: FieldDefinition[];
  onClose: () => void;
  onSave: (values: Row) => void;
  row?: Row;
  title: string;
  viewOnly?: boolean;
}) {
  const [form, setForm] = useState<Row>(() => {
    const initial: Row = {};
    fields.forEach((field) => {
      initial[field.key] = row?.[field.key] ?? "";
    });
    return initial;
  });

  function update(key: string, value: any) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <h2>{viewOnly ? `查看${title}` : row ? `编辑${title}` : `新增${title}`}</h2>
            <span>{viewOnly ? "查看完整信息" : row ? "修改后保存" : "填写基础信息"}</span>
          </div>
          <button className="modal-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="seller-form-grid">
          {viewOnly ? fields.map((field) => (
            <div className="field view-field" key={field.key}>
              <span>{field.label}</span>
              {field.type === "file" && form[field.key] ? (
                <img className="logo-preview" src={String(form[field.key])} alt={field.label} />
              ) : (
                <div className="view-field-value">{field.type === "yesno" ? (form[field.key] ? "是" : "否") : String(form[field.key] || "-")}</div>
              )}
            </div>
          )) : fields.map((field) =>
            field.type === "textarea" ? (
              <TextAreaField key={field.key} label={field.label} value={String(form[field.key] ?? "")} onChange={(value) => update(field.key, value)} />
            ) : field.type === "file" ? (
              <LogoField key={field.key} value={String(form[field.key] ?? "")} onChange={(value) => update(field.key, value)} />
            ) : field.type === "yesno" ? (
              <ChoiceField key={field.key} label={field.label} value={String(form[field.key] ? "yes" : "no")} options={[["no", "否"], ["yes", "是"]]} onChange={(value) => update(field.key, value === "yes" ? 1 : 0)} />
            ) : (
              <Field key={field.key} label={field.label} type={field.type ?? "text"} value={String(form[field.key] ?? "")} onChange={(value) => update(field.key, value)} />
            ),
          )}
        </div>
        {!viewOnly ? <div className="modal-footer">
          <button className="primary-button" onClick={() => onSave(form)}>
            保存
          </button>
        </div> : null}
      </div>
    </div>
  );
}

function Field({
  label,
  onChange = () => {},
  placeholder,
  readOnly = false,
  required = false,
  type = "text",
  value,
}: {
  label: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className={`field${required ? " required-field" : ""}`}>
      <span>{label}</span>
      <input placeholder={placeholder} readOnly={readOnly} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, onChange, placeholder, value }: { label: string; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <label className="field textarea-field">
      <span>{label}</span>
      <textarea placeholder={placeholder} rows={5} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  fallbackKey,
  label,
  labelKey,
  onChange,
  optional = false,
  rows,
  value,
}: {
  fallbackKey?: string;
  label: string;
  labelKey: string;
  onChange: (value: string) => void;
  optional?: boolean;
  rows: Row[];
  value: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? "不选择" : "请选择"}</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row[labelKey] || (fallbackKey ? row[fallbackKey] : "")}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChoiceField({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: [string, string][]; value: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextSelectField({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function LogoField({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  async function handleFile(file?: File) {
    if (!file) return;
    onChange(await imageFileToDataUrl(file));
  }
  return (
    <label className="field logo-upload-field">
      <span>LOGO</span>
      <input className="logo-upload-input" type="file" accept="image/*" onChange={(event) => handleFile(event.target.files?.[0])} />
      <div className={`logo-upload-box${value ? " has-logo" : ""}`}>
        {value ? (
          <>
            <img className="logo-upload-preview" src={value} alt="logo preview" />
            <strong>点击更换 LOGO</strong>
          </>
        ) : (
          <>
            <Plus size={20} />
            <strong>点击上传 LOGO</strong>
            <em>支持 PNG、JPG、JPEG</em>
          </>
        )}
      </div>
    </label>
  );
}

function DetailItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{String(value || "-")}</strong>
    </div>
  );
}

function AmountWords({ amount, chinese, english, label }: { amount: string; chinese: string; english: string; label: string }) {
  return (
    <div className="amount-word-row">
      <span>{label}</span>
      <div>
        <p className="amount-number"><em>金额</em>{amount}</p>
        <p><em>EN</em>{english}</p>
        <p><em>中文</em>{chinese}</p>
      </div>
    </div>
  );
}

function buildContractPreviewFromRows(
  contract?: ContractDraft,
  data?: Record<TableName, Row[]>,
  totalAmount = 0,
  advanceAmount = 0,
  balanceAmount = 0,
) {
  if (!contract || !data) return null;
  const seller = data.companies.find((row) => Number(row.id) === Number(contract.seller_id));
  const buyer = data.customers.find((row) => Number(row.id) === Number(contract.buyer_id));
  const manager = data.customer_managers.find((row) => Number(row.id) === Number(contract.customer_manager_id));
  const product = data.products.find((row) => Number(row.id) === Number(contract.product_id));
  if (!contract.contract_no.trim() || !seller || !buyer || !manager || !product) {
    return null;
  }
  const loadingPort = data.ports.find((row) => row.name_en === contract.loading_port);
  const destinationPort = data.ports.find((row) => row.name_en === contract.destination_port);
  const terms = contract.term_configuration_id
    ? data.term_configuration_items
        .filter((item) => Number(item.config_id) === Number(contract.term_configuration_id))
        .sort((left, right) => Number(left.sort_order) - Number(right.sort_order))
        .map((item) => data.contract_terms.find((term) => Number(term.id) === Number(item.term_id)))
        .filter(Boolean)
    : [];
  const quantity = Number(contract.quantity) || 0;
  const unitPrice = Number(contract.unit_price) || 0;
  const palletized = contract.palletized === "yes";
  const drumWeight = product.kgs_per_drum || "-";
  const advanceText = formatContractAmount(advanceAmount);
  const balanceText = formatContractAmount(balanceAmount);
  const paymentDeadlineEn = formatPaymentDateEnglish(contract.expiry_date);
  const paymentDeadlineCn = formatChineseDate(contract.expiry_date);

  return {
    contractNo: contract.contract_no,
    purchaseNo: contract.purchase_no,
    drumCount: Number(contract.drum_count) || 0,
    issueDate: contract.issue_date,
    issueDateLong: formatSignatureDateEnglish(contract.issue_date),
    piExpiryDate: contract.pi_expiry_date,
    seller,
    buyer,
    customerManager: manager,
    product,
    quantity,
    unitPrice,
    totalAmount,
    advanceAmount,
    balanceAmount,
    palletized,
    tradeTerms: contract.trade_terms,
    loadingPortEn: contract.loading_port,
    loadingPortCn: loadingPort?.name_cn || contract.loading_port,
    destinationPortEn: contract.destination_port,
    destinationPortCn: destinationPort?.name_cn || contract.destination_port,
    packingEn: `The product packaging uses new closed steel drums${palletized ? " with pallets" : ""}. The net product weight of each drum is ${drumWeight} kg.`,
    packingCn: `产品使用新的封闭钢桶包装${palletized ? "并打托" : "，不打托"}，每桶净重 ${drumWeight} 公斤。`,
    paymentTermsEn: `The buyer shall pay the purchase price to the seller by wire transfer before ${paymentDeadlineEn}, totaling $${advanceText}(in words: ${toEnglishDollarWords(advanceAmount)}). The remaining payment should be paid within five business days upon receipt of the copy of the bill of lading,totaling $${balanceText}(in words:${toEnglishDollarWords(balanceAmount)}). In case of overdue payment, the Seller may have the right to cancel the contract and the Buyer shall compensate the Seller for all losses caused thereform.`,
    paymentTermsCn: `买方应于${paymentDeadlineCn}前通过电汇向卖方支付的货款，总额为${advanceText}美元（用文字表述：${toChineseDollarWords(advanceAmount)}）。余款应于收到提单副本后五个工作日内付清，总额为${balanceText}美元（用文字表述：${toChineseDollarWords(balanceAmount)}）。若逾期付款，卖方有权解除合同，买方须赔偿卖方由此造成的全部损失。`,
    terms,
  };
}

function buildShippingExcelFields(preview: NonNullable<ContractPreview>) {
  const netWeightPerDrum = Number(preview.product.kgs_per_drum) || 0;
  const grossWeightPerDrum = netWeightPerDrum + 18;
  return {
    ...buildContractExcelFields(preview),
    purchase_no: preview.purchaseNo || "-",
    drum_count: String(preview.drumCount),
    net_weight_per_drum: formatQuantity(netWeightPerDrum),
    total_net_weight: formatQuantity(netWeightPerDrum * preview.drumCount),
    gross_weight_per_drum: formatQuantity(grossWeightPerDrum),
    total_gross_weight: formatQuantity(grossWeightPerDrum * preview.drumCount),
    dimension_per_drum: "0.24",
    total_dimension: formatQuantity(0.24 * preview.drumCount),
  };
}

function normalizeContactPerson(value: unknown) {
  const contact = String(value ?? "").trim();
  return !contact || contact === "/" ? "***" : contact;
}

function formatCustomerContact(value: unknown) {
  const contact = String(value ?? "").trim();
  return !contact || contact === "/" ? "-" : contact;
}

function buildContractExcelFields(preview: NonNullable<ContractPreview>) {
  const productPalletEn = preview.palletized ? "with pallets" : "without pallets";
  const productPalletCn = preview.palletized ? "含托盘" : "不含托盘";
  const fields: Record<string, string> = {
    contract_no: preview.contractNo,
    issue_date_long: preview.issueDateLong,
    seller_name_en: preview.seller.company_name_en || "-",
    seller_name_cn: preview.seller.company_name_cn || "-",
    seller_jurisdiction_en: "China",
    seller_jurisdiction_cn: "中国",
    seller_address: preview.seller.address || "-",
    seller_contact: [preview.customerManager.name, preview.customerManager.phone].filter(Boolean).join(" ") || "-",
    seller_email: preview.customerManager.email || "-",
    seller_bank_information: formatSellerBankInformation(preview.seller),
    buyer_name_en: preview.buyer.company_name_en || "-",
    buyer_name_cn: preview.buyer.company_name_cn || "-",
    buyer_country: preview.buyer.country || "-",
    buyer_country_cn: preview.buyer.country_cn || preview.buyer.country || "-",
    buyer_address: preview.buyer.address || "-",
    buyer_phone: preview.buyer.phone || "-",
    buyer_contact_person: normalizeContactPerson(preview.buyer.contact_person),
    buyer_email: preview.buyer.email ? `E-mail: ${preview.buyer.email}` : "-",
    product_name_en: `${preview.product.name_en}(${productPalletEn})`,
    product_name_cn: `${preview.product.name_cn || "-"}（${productPalletCn}）`,
    product_hs_code: preview.product.hs_code || "-",
    product_purity: preview.product.model || "-",
    quantity_mt: formatQuantity(preview.quantity),
    unit_price: formatPlainMoney(preview.unitPrice),
    total_amount: formatPlainMoney(preview.totalAmount),
    total_amount_words_en: toEnglishDollarWords(preview.totalAmount),
    total_amount_words_cn: toChineseDollarWords(preview.totalAmount),
    trade_terms: preview.tradeTerms,
    payment_terms_en: preview.paymentTermsEn,
    payment_terms_cn: preview.paymentTermsCn,
    loading_port_en: preview.loadingPortEn,
    loading_port_cn: preview.loadingPortCn,
    destination_port: preview.destinationPortEn,
    destination_port_cn: preview.destinationPortCn,
    packing_en: preview.packingEn,
    packing_cn: preview.packingCn,
  };
  for (let index = 0; index < 6; index += 1) {
    const term = preview.terms[index];
    fields[`term_${index + 1}_en`] = term?.content_en || "";
    fields[`term_${index + 1}_cn`] = term?.content_cn || "";
  }
  return fields;
}

function buildPiExcelFields(preview: NonNullable<ContractPreview>) {
  return {
    ...buildContractExcelFields(preview),
    pi_no: preview.contractNo,
    issue_date_serial: String(toExcelDateSerial(preview.issueDate)),
    expiry_date_serial: String(toExcelDateSerial(preview.piExpiryDate)),
    pi_expiry_date_en: formatPaymentDateEnglish(preview.piExpiryDate),
    pi_expiry_date_cn: formatChineseDate(preview.piExpiryDate),
    trade_terms_en: `${preview.tradeTerms} ${preview.destinationPortEn}`,
    trade_terms_cn: `${preview.tradeTerms} ${preview.destinationPortCn}`,
    loading_port: [preview.loadingPortEn, preview.loadingPortCn].filter(Boolean).join(" / "),
    destination_port_bilingual: [preview.destinationPortEn, preview.destinationPortCn].filter(Boolean).join(" / "),
    product_model: preview.product.model || "-",
    buyer_phone_line: preview.buyer.phone || "-",
    buyer_email_line: preview.buyer.email ? `E-mail: ${preview.buyer.email}` : "-",
    seller_contact_line: [preview.customerManager.name, preview.customerManager.phone].filter(Boolean).join(" ") || "-",
    seller_email_line: preview.customerManager.email ? `E-mail: ${preview.customerManager.email}` : "-",
    total_amount_line_en: `Total Amount: $${formatPlainMoney(preview.totalAmount)} (in words: ${toEnglishDollarWords(preview.totalAmount)})`,
    total_amount_line_cn: `合计金额：${formatPlainMoney(preview.totalAmount)}美元（大写：${toChineseDollarWords(preview.totalAmount)}）`,
  };
}

function createTermConfigurationDraftItem(): TermConfigurationDraftItem {
  return {
    draft_id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    term_id: "",
  };
}

function emptyTermConfigurationForm(): TermConfigurationFormState {
  return {
    config_no: "",
    config_date: today,
    items: [createTermConfigurationDraftItem()],
  };
}

function contractDraftToPayload(contract: ContractDraft, balanceAmount: number): Row {
  return {
    contract_no: contract.contract_no.trim(),
    issue_date: contract.issue_date,
    buyer_id: toNullableNumber(contract.buyer_id),
    seller_id: toNullableNumber(contract.seller_id),
    customer_manager_id: toNullableNumber(contract.customer_manager_id),
    product_id: toNullableNumber(contract.product_id),
    term_configuration_id: toNullableNumber(contract.term_configuration_id),
    quantity: Number(contract.quantity) || 0,
    unit_price: Number(contract.unit_price) || 0,
    advance_amount: Number(contract.advance_amount) || 0,
    balance_amount: balanceAmount,
    destination_port: contract.destination_port,
    loading_port: contract.loading_port,
    trade_terms: contract.trade_terms,
    expiry_date: contract.expiry_date,
    pi_expiry_date: contract.pi_expiry_date,
    palletized: contract.palletized,
    drum_count: Number(contract.drum_count) || 0,
    purchase_no: contract.purchase_no,
  };
}

function validateContractDraft(contract: ContractDraft) {
  const missing: string[] = [];
  const requiredTextFields: Array<[keyof ContractDraft, string]> = [
    ["contract_no", "合同编码"],
    ["issue_date", "签订日期"],
    ["buyer_id", "买方信息"],
    ["seller_id", "贸易户头"],
    ["customer_manager_id", "客户经理"],
    ["product_id", "产品信息"],
    ["term_configuration_id", "合同条款配置"],
    ["quantity", "产品数量"],
    ["unit_price", "单价"],
    ["advance_amount", "预付款"],
    ["expiry_date", "付款日期"],
    ["pi_expiry_date", "PI有效期"],
    ["palletized", "是否打托"],
    ["trade_terms", "贸易条款"],
    ["loading_port", "装运港"],
    ["destination_port", "目的港"],
    ["purchase_no", "PO No."],
    ["drum_count", "装桶数量"],
  ];
  requiredTextFields.forEach(([key, label]) => {
    if (!String(contract[key] ?? "").trim()) missing.push(label);
  });
  if (missing.length > 0) {
    return `请填写以下信息后再保存单据：${missing.join("、")}`;
  }
  return "";
}

function contractRowToDraft(row: Row): ContractDraft {
  return {
    contract_no: String(row.contract_no ?? ""),
    issue_date: String(row.issue_date || today),
    buyer_id: stringifyId(row.buyer_id),
    seller_id: stringifyId(row.seller_id),
    customer_manager_id: stringifyId(row.customer_manager_id),
    product_id: stringifyId(row.product_id),
    term_configuration_id: stringifyId(row.term_configuration_id),
    quantity: String(row.quantity ?? ""),
    unit_price: String(row.unit_price ?? ""),
    advance_amount: String(row.advance_amount ?? ""),
    destination_port: String(row.destination_port ?? ""),
    loading_port: String(row.loading_port ?? ""),
    trade_terms: (row.trade_terms === "FOB" || row.trade_terms === "CFR" ? row.trade_terms : "CIF") as ContractDraft["trade_terms"],
    expiry_date: String(row.expiry_date || defaultExpiryDate),
    pi_expiry_date: String(row.pi_expiry_date || defaultExpiryDate),
    palletized: row.palletized === "yes" ? "yes" : "no",
    drum_count: String(row.drum_count ?? "0"),
    purchase_no: String(row.purchase_no ?? ""),
    purchase_no_touched: "yes",
  };
}

function toNullableNumber(value: string) {
  return value ? Number(value) : null;
}

function stringifyId(value: unknown) {
  return value === undefined || value === null || value === "" ? "" : String(value);
}

function findNameById(rows: Row[], id: unknown, primaryKey: string, fallbackKey?: string) {
  const row = rows.find((item) => Number(item.id) === Number(id));
  return String(row?.[primaryKey] || (fallbackKey ? row?.[fallbackKey] : "") || "-");
}

function formatTermOptionLabel(term: Row) {
  const description = String(term.content_cn || term.content_en || "无描述");
  const compactDescription = description.replace(/\s+/g, " ").trim();
  const maxLength = 52;
  const suffix = compactDescription.length > maxLength ? "..." : "";
  return `${compactDescription.slice(0, maxLength)}${suffix}`;
}

function hasDuplicateNonEmptyValues(values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}

function normalizePayload(section: DataSectionId, values: Row) {
  const payload: Row = { ...values };
  if (section === "products") {
    payload.is_drug_precursor = values.is_drug_precursor ? 1 : 0;
  }
  if (section === "customers") {
    payload.customer_type = values.customer_type || "终端客户";
  }
  if (section === "termConfigurations" && !payload.config_date) {
    payload.config_date = today;
  }
  return payload;
}

function formatCellValue(value: any) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string" && value.startsWith("data:image/")) return "已上传";
  return value;
}

function formatSellerBankInformation(seller: Row) {
  return [
    `Seller' bank information: ${seller.bank_name_en || "-"}`,
    `卖方开户行：${seller.bank_name_cn || "-"}`,
    `Beneficiary: ${seller.company_name_en || "-"}`,
    `受益人：${seller.company_name_cn || "-"}`,
    `SWIFT CODE: ${seller.swift_code || "-"}`,
    `银行国际代码：${seller.swift_code || "-"}`,
    `USD ACCOUNT: ${seller.usd_account || "-"}`,
    `美元账号：${seller.usd_account || "-"}`,
  ].join("\n");
}

function imageFileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageSourceToPngDataUrl(source: string) {
  return new Promise<string>((resolve, reject) => {
    if (source.startsWith("data:image/png")) {
      resolve(source);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建图片画布"));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("无法读取图片文件"));
    image.src = source;
  });
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseLocalDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPaymentDateEnglish(value: string) {
  const date = parseLocalDate(value);
  if (!date) return value || "-";
  return `${date.getDate()}${getOrdinalSuffix(date.getDate())} ${date.toLocaleString("en-GB", { month: "long" })}.${date.getFullYear()}`;
}

function formatSignatureDateEnglish(value: string) {
  const date = parseLocalDate(value);
  if (!date) return value || "-";
  return `${date.getDate()}${getOrdinalSuffix(date.getDate())}.${date.toLocaleString("en-GB", { month: "long" })}.${date.getFullYear()}`;
}

function formatChineseDate(value: string) {
  const date = parseLocalDate(value);
  if (!date) return value || "-";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getOrdinalSuffix(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
}

function toExcelDateSerial(value: string) {
  const date = parseLocalDate(value);
  if (!date) return 0;
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

function formatPlainMoney(value: number) {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

function formatQuantity(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatContractAmount(value: number) {
  return (Math.round((Number.isFinite(value) ? value : 0) * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
}

const englishOnes = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const englishTens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function toEnglishDollarWords(value: number) {
  const totalCents = Math.round(Math.abs(value) * 100);
  const dollars = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  if (dollars === 0 && cents === 0) return "SAY US DOLLARS ZERO ONLY";
  return `SAY US DOLLARS ${dollars > 0 ? numberToEnglish(dollars) : "ZERO"}${cents > 0 ? ` AND ${numberToEnglish(cents)} CENTS` : ""} ONLY`;
}

function numberToEnglish(value: number): string {
  if (value < 20) return englishOnes[value];
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const one = value % 10;
    return one ? `${englishTens[ten]}-${englishOnes[one]}` : englishTens[ten];
  }
  if (value < 1000) {
    const hundred = Math.floor(value / 100);
    const rest = value % 100;
    return [englishOnes[hundred], "HUNDRED", rest ? `AND ${numberToEnglish(rest)}` : ""].filter(Boolean).join(" ");
  }
  for (const [unit, label] of [[1_000_000_000, "BILLION"], [1_000_000, "MILLION"], [1000, "THOUSAND"]] as const) {
    if (value >= unit) {
      const head = Math.floor(value / unit);
      const rest = value % unit;
      return [numberToEnglish(head), label, rest ? numberToEnglish(rest) : ""].filter(Boolean).join(" ");
    }
  }
  return "";
}

const chineseDigits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const chineseUnits = ["", "拾", "佰", "仟"];
const chineseSections = ["", "万", "亿", "兆"];

function toChineseDollarWords(value: number) {
  const totalCents = Math.round(Math.abs(value) * 100);
  const dollars = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  if (dollars === 0 && cents === 0) return "零美元整";
  const dollarWords = dollars > 0 ? `${numberToChineseUpper(dollars)}美元` : "零美元";
  return cents > 0 ? `${dollarWords}${numberToChineseUpper(cents)}美分` : `${dollarWords}整`;
}

function numberToChineseUpper(value: number) {
  const sections: string[] = [];
  let remaining = value;
  let sectionIndex = 0;
  while (remaining > 0) {
    const section = remaining % 10000;
    if (section !== 0) {
      sections.unshift(`${sectionToChinese(section)}${chineseSections[sectionIndex]}`);
    } else if (sections.length > 0 && !sections[0].startsWith("零")) {
      sections.unshift("零");
    }
    remaining = Math.floor(remaining / 10000);
    sectionIndex += 1;
  }
  return sections.join("").replace(/零+/g, "零").replace(/零$/g, "");
}

function sectionToChinese(section: number) {
  let result = "";
  let zeroPending = false;
  for (let position = 0; position < 4; position += 1) {
    const unitValue = Math.floor(section / 10 ** (3 - position)) % 10;
    const unitName = chineseUnits[3 - position];
    if (unitValue === 0) {
      if (result) zeroPending = true;
      continue;
    }
    if (zeroPending) {
      result += "零";
      zeroPending = false;
    }
    result += `${chineseDigits[unitValue]}${unitName}`;
  }
  return result;
}
