use base64::{engine::general_purpose, Engine as _};
use rusqlite::{
    params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Cursor, Read, Write},
    path::PathBuf,
    process::Command,
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
use zip::{write::FileOptions, ZipArchive, ZipWriter};

struct Database {
    connection: Mutex<Option<Connection>>,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseMeta {
    db_path: String,
    tables: Vec<&'static str>,
}

#[derive(Serialize)]
struct IdResult {
    id: i64,
}

#[derive(Deserialize)]
struct TermConfigurationItem {
    item_code: String,
    term_id: i64,
    sort_order: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceResult {
    config_id: i64,
    count: usize,
}

#[derive(Serialize)]
struct DeleteResult {
    count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractExcelPayload {
    contract_no: String,
    fields: HashMap<String, String>,
    logo_data: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedContractResult {
    path: String,
}

const TABLE_NAMES: [&str; 10] = [
    "users",
    "companies",
    "customers",
    "customer_managers",
    "ports",
    "products",
    "contract_terms",
    "term_configurations",
    "term_configuration_items",
    "contracts",
];

#[cfg(windows)]
fn apply_native_titlebar_style(window: &tauri::WebviewWindow) {
    use std::mem::size_of;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let caption_color: u32 = 0x002a170f; // COLORREF for #0f172a.
    let text_color: u32 = 0x00fcfaf8; // COLORREF for #f8fafc.

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption_color as *const _ as _,
            size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &caption_color as *const _ as _,
            size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text_color as *const _ as _,
            size_of::<u32>() as u32,
        );
    }
}

#[cfg(not(windows))]
fn apply_native_titlebar_style(_window: &tauri::WebviewWindow) {}

fn table_fields() -> HashMap<&'static str, &'static [&'static str]> {
    HashMap::from([
        ("users", &["name", "email", "phone"][..]),
        (
            "companies",
            &[
                "company_name_en",
                "company_name_cn",
                "address",
                "bank_name_en",
                "bank_name_cn",
                "swift_code",
                "usd_account",
                "content",
                "logo_data",
            ][..],
        ),
        (
            "customers",
            &[
                "company_name_en",
                "company_name_cn",
                "address",
                "phone",
                "customer_type",
                "country",
                "country_cn",
                "email",
                "contact_person",
                "ntn",
            ][..],
        ),
        ("customer_managers", &["name", "phone", "email"][..]),
        ("ports", &["name_en", "name_cn"][..]),
        (
            "products",
            &[
                "name_en",
                "name_cn",
                "hs_code",
                "model",
                "kgs_per_drum",
                "cas",
                "is_drug_precursor",
            ][..],
        ),
        (
            "contract_terms",
            &["term_code", "content_cn", "content_en"][..],
        ),
        ("term_configurations", &["config_no", "config_date"][..]),
        (
            "term_configuration_items",
            &["config_id", "item_code", "term_id", "sort_order"][..],
        ),
        (
            "contracts",
            &[
                "contract_no",
                "issue_date",
                "buyer_id",
                "seller_id",
                "product_id",
                "term_id",
                "term_configuration_id",
                "quantity",
                "unit_price",
                "advance_amount",
                "balance_amount",
                "destination_port",
                "loading_port",
                "trade_terms",
                "expiry_date",
                "pi_expiry_date",
                "palletized",
                "customer_manager_id",
                "purchase_no",
                "drum_count",
            ][..],
        ),
    ])
}

fn accepted_fields(table_name: &str, payload: &Map<String, Value>) -> Result<Vec<String>, String> {
    let fields = table_fields();
    let allowed = fields
        .get(table_name)
        .ok_or_else(|| format!("Unknown table: {table_name}"))?;
    let result = allowed
        .iter()
        .filter(|field| payload.contains_key(**field))
        .map(|field| (*field).to_string())
        .collect::<Vec<_>>();
    if result.is_empty() {
        return Err("No accepted fields in payload".into());
    }
    Ok(result)
}

fn to_sql_value(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        Value::String(value) => SqlValue::Text(value.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(value.to_string()),
    }
}

fn from_sql_value(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::Number(Number::from(value)),
        ValueRef::Real(value) => Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::Array(
            value
                .iter()
                .map(|byte| Value::Number(Number::from(*byte)))
                .collect(),
        ),
    }
}

fn with_database_connection<T>(
    database: State<'_, Database>,
    task: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut connection = database
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    if connection.is_none() {
        *connection = Some(open_database(PathBuf::from(&database.path))?);
    }
    task(
        connection
            .as_mut()
            .ok_or_else(|| "Database connection is not available".to_string())?,
    )
}

#[tauri::command]
fn db_meta(database: State<'_, Database>) -> DatabaseMeta {
    DatabaseMeta {
        db_path: database.path.clone(),
        tables: TABLE_NAMES.to_vec(),
    }
}

#[tauri::command]
fn db_list(database: State<'_, Database>, table_name: String) -> Result<Vec<Value>, String> {
    if !TABLE_NAMES.contains(&table_name.as_str()) {
        return Err(format!("Unknown table: {table_name}"));
    }
    with_database_connection(database, |connection| {
        let order_by = if table_name == "term_configuration_items" {
            "config_id DESC, sort_order ASC, id ASC"
        } else {
            "id DESC"
        };
        let mut statement = connection
            .prepare(&format!("SELECT * FROM {table_name} ORDER BY {order_by}"))
            .map_err(|error| error.to_string())?;
        let column_names = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        let rows = statement
            .query_map([], |row| {
                let mut object = Map::new();
                for (index, name) in column_names.iter().enumerate() {
                    object.insert(name.clone(), from_sql_value(row.get_ref(index)?));
                }
                Ok(Value::Object(object))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn db_create(
    database: State<'_, Database>,
    table_name: String,
    payload: Map<String, Value>,
) -> Result<IdResult, String> {
    let fields = accepted_fields(&table_name, &payload)?;
    let placeholders = vec!["?"; fields.len()].join(", ");
    let sql = format!(
        "INSERT INTO {table_name} ({}) VALUES ({placeholders})",
        fields.join(", ")
    );
    let values = fields
        .iter()
        .map(|field| to_sql_value(&payload[field]))
        .collect::<Vec<_>>();
    with_database_connection(database, |connection| {
        connection
            .execute(&sql, params_from_iter(values))
            .map_err(|error| error.to_string())?;
        Ok(IdResult {
            id: connection.last_insert_rowid(),
        })
    })
}

#[tauri::command]
fn db_update(
    database: State<'_, Database>,
    table_name: String,
    id: i64,
    payload: Map<String, Value>,
) -> Result<IdResult, String> {
    let fields = accepted_fields(&table_name, &payload)?;
    let assignments = fields
        .iter()
        .map(|field| format!("{field} = ?"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("UPDATE {table_name} SET {assignments} WHERE id = ?");
    let mut values = fields
        .iter()
        .map(|field| to_sql_value(&payload[field]))
        .collect::<Vec<_>>();
    values.push(SqlValue::Integer(id));
    with_database_connection(database, |connection| {
        connection
            .execute(&sql, params_from_iter(values))
            .map_err(|error| error.to_string())?;
        Ok(IdResult { id })
    })
}

#[tauri::command]
fn db_delete_many(
    database: State<'_, Database>,
    table_name: String,
    ids: Vec<i64>,
) -> Result<DeleteResult, String> {
    if !TABLE_NAMES.contains(&table_name.as_str()) {
        return Err(format!("Unknown table: {table_name}"));
    }
    if ids.is_empty() {
        return Ok(DeleteResult { count: 0 });
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let sql = format!("DELETE FROM {table_name} WHERE id IN ({placeholders})");
    with_database_connection(database, |connection| {
        if table_name == "contract_terms" {
            let transaction = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    &format!(
                        "UPDATE contracts SET term_id = NULL WHERE term_id IN ({placeholders})"
                    ),
                    params_from_iter(ids.iter().copied()),
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    &format!(
                        "DELETE FROM term_configuration_items WHERE term_id IN ({placeholders})"
                    ),
                    params_from_iter(ids.iter().copied()),
                )
                .map_err(|error| error.to_string())?;
            let count = transaction
                .execute(
                    &format!("DELETE FROM contract_terms WHERE id IN ({placeholders})"),
                    params_from_iter(ids.iter().copied()),
                )
                .map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())?;
            return Ok(DeleteResult { count });
        }
        let count = connection
            .execute(&sql, params_from_iter(ids))
            .map_err(|error| error.to_string())?;
        Ok(DeleteResult { count })
    })
}

#[tauri::command]
fn db_replace_term_configuration_items(
    database: State<'_, Database>,
    config_id: i64,
    items: Vec<TermConfigurationItem>,
) -> Result<ReplaceResult, String> {
    let mut seen_codes = HashSet::new();
    for item in &items {
        let code = item.item_code.trim();
        if code.is_empty() || !seen_codes.insert(code.to_string()) {
            return Err("Duplicate or empty term configuration item code".into());
        }
    }

    with_database_connection(database, |connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM term_configuration_items WHERE config_id = ?",
                [config_id],
            )
            .map_err(|error| error.to_string())?;
        {
            let mut insert = transaction
                .prepare(
                    "INSERT INTO term_configuration_items (config_id, item_code, term_id, sort_order) VALUES (?, ?, ?, ?)",
                )
                .map_err(|error| error.to_string())?;
            for item in &items {
                insert
                    .execute(params![
                        config_id,
                        item.item_code.trim(),
                        item.term_id,
                        item.sort_order
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(ReplaceResult {
            config_id,
            count: items.len(),
        })
    })
}

#[tauri::command]
fn generate_contract_pdf(
    app: AppHandle,
    payload: ContractExcelPayload,
) -> Result<GeneratedContractResult, String> {
    let template_path = find_contract_template(&app)?;

    let output_dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?
        .join("YS Contracts");
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let filename = sanitize_filename(&payload.contract_no);
    let pdf_path = output_dir.join(format!("{filename}.pdf"));
    let temp_xlsx_path = output_dir.join(format!("{filename}.exporting.xlsx"));

    let output = build_contract_xlsx(&template_path, &payload)?;
    fs::write(&temp_xlsx_path, output).map_err(|error| error.to_string())?;
    let conversion_result = convert_xlsx_to_pdf(&temp_xlsx_path, &pdf_path);
    match conversion_result {
        Ok(()) => {
            let _ = fs::remove_file(&temp_xlsx_path);
        }
        Err(error) => {
            return Err(format!(
                "{error} 临时文件已保留：{}",
                temp_xlsx_path.to_string_lossy()
            ));
        }
    }

    Ok(GeneratedContractResult {
        path: pdf_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn generate_pi_pdf(
    app: AppHandle,
    payload: ContractExcelPayload,
) -> Result<GeneratedContractResult, String> {
    let template_path = find_pi_template(&app)?;

    let output_dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?
        .join("YS Contracts");
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let filename = sanitize_filename(&format!("{}_PI", payload.contract_no));
    let pdf_path = output_dir.join(format!("{filename}.pdf"));
    let temp_xlsx_path = output_dir.join(format!("{filename}.exporting.xlsx"));

    let output = build_pi_xlsx(&template_path, &payload)?;
    fs::write(&temp_xlsx_path, output).map_err(|error| error.to_string())?;
    let conversion_result = convert_xlsx_to_pdf(&temp_xlsx_path, &pdf_path);
    match conversion_result {
        Ok(()) => {
            let _ = fs::remove_file(&temp_xlsx_path);
        }
        Err(error) => {
            return Err(format!(
                "{error} 临时文件已保留：{}",
                temp_xlsx_path.to_string_lossy()
            ));
        }
    }

    Ok(GeneratedContractResult {
        path: pdf_path.to_string_lossy().into_owned(),
    })
}

fn generate_shipping_pdf(
    app: AppHandle,
    payload: ContractExcelPayload,
    template_name: &str,
    filename_suffix: &str,
) -> Result<GeneratedContractResult, String> {
    let template_path = find_template(&app, template_name)?;
    let output_dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?
        .join("YS Contracts");
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let filename = sanitize_filename(&format!("{}_{}", payload.contract_no, filename_suffix));
    let pdf_path = output_dir.join(format!("{filename}.pdf"));
    let temp_xlsx_path = output_dir.join(format!("{filename}.exporting.xlsx"));
    let output = build_xlsx_from_template(&template_path, &payload, true, false)?;
    fs::write(&temp_xlsx_path, output).map_err(|error| error.to_string())?;
    convert_xlsx_to_pdf(&temp_xlsx_path, &pdf_path).map_err(|error| {
        format!(
            "{error} 临时文件已保留：{}",
            temp_xlsx_path.to_string_lossy()
        )
    })?;
    let _ = fs::remove_file(&temp_xlsx_path);
    Ok(GeneratedContractResult {
        path: pdf_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn generate_packing_list_pdf(
    app: AppHandle,
    payload: ContractExcelPayload,
) -> Result<GeneratedContractResult, String> {
    generate_shipping_pdf(app, payload, "Packing List Template.xlsx", "PL")
}

#[tauri::command]
fn generate_commercial_invoice_pdf(
    app: AppHandle,
    payload: ContractExcelPayload,
) -> Result<GeneratedContractResult, String> {
    generate_shipping_pdf(app, payload, "Commercial Invoice Template.xlsx", "CI")
}

fn build_contract_xlsx(
    template_path: &PathBuf,
    payload: &ContractExcelPayload,
) -> Result<Vec<u8>, String> {
    build_xlsx_from_template(template_path, payload, true, false)
}

fn build_pi_xlsx(
    template_path: &PathBuf,
    payload: &ContractExcelPayload,
) -> Result<Vec<u8>, String> {
    build_xlsx_from_template(template_path, payload, true, true)
}

fn build_xlsx_from_template(
    template_path: &PathBuf,
    payload: &ContractExcelPayload,
    include_logo: bool,
    is_pi_template: bool,
) -> Result<Vec<u8>, String> {
    let template_bytes = fs::read(&template_path).map_err(|error| error.to_string())?;
    let logo_bytes = include_logo
        .then(|| {
            payload
                .logo_data
                .as_deref()
                .and_then(|value| decode_logo_data(value).ok())
        })
        .flatten();
    let cursor = Cursor::new(template_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|error| error.to_string())?;
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut output);
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
            let name = file.name().to_string();
            let options = FileOptions::default()
                .compression_method(file.compression())
                .last_modified_time(file.last_modified())
                .unix_permissions(file.unix_mode().unwrap_or(0o644));

            if file.is_dir() {
                writer
                    .add_directory(name, options)
                    .map_err(|error| error.to_string())?;
                continue;
            }

            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;

            writer
                .start_file(name.clone(), options)
                .map_err(|error| error.to_string())?;

            if include_logo && name == "xl/media/image1.png" {
                if let Some(logo_bytes) = &logo_bytes {
                    writer
                        .write_all(logo_bytes)
                        .map_err(|error| error.to_string())?;
                } else {
                    writer
                        .write_all(&bytes)
                        .map_err(|error| error.to_string())?;
                }
            } else if name.ends_with(".xml") {
                let text = String::from_utf8(bytes).map_err(|error| error.to_string())?;
                let mut replaced = apply_trade_terms_replacements(
                    &replace_contract_placeholders(&text, &payload.fields),
                    payload
                        .fields
                        .get("trade_terms")
                        .map(String::as_str)
                        .unwrap_or(""),
                );
                if is_pi_template {
                    replaced = apply_pi_template_replacements(&replaced, &payload.fields, &name);
                }
                writer
                    .write_all(replaced.as_bytes())
                    .map_err(|error| error.to_string())?;
            } else {
                writer
                    .write_all(&bytes)
                    .map_err(|error| error.to_string())?;
            }
        }
        writer.finish().map_err(|error| error.to_string())?;
    }

    Ok(output.into_inner())
}

#[cfg(target_os = "windows")]
fn convert_xlsx_to_pdf(xlsx_path: &PathBuf, pdf_path: &PathBuf) -> Result<(), String> {
    let mut errors = Vec::new();
    let com_exporters = [
        ("Microsoft Excel", "Excel.Application"),
        ("WPS 表格", "Ket.Application"),
        ("WPS 表格", "KET.Application"),
        ("WPS 表格", "Et.Application"),
    ];

    for (display_name, prog_id) in com_exporters {
        match convert_xlsx_to_pdf_with_com(display_name, prog_id, xlsx_path, pdf_path) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(error),
        }
    }

    match convert_xlsx_to_pdf_with_libreoffice(xlsx_path, pdf_path) {
        Ok(()) => Ok(()),
        Err(error) => {
            errors.push(error);
            Err(format!(
                "PDF 导出失败：未能调用 Microsoft Excel、WPS 表格或 LibreOffice 完成转换。请安装其中任意一个软件后重试，或手动打开保留的 xlsx 文件另存为 PDF。{}",
                format_export_errors(&errors)
            ))
        }
    }
}

#[cfg(target_os = "windows")]
fn convert_xlsx_to_pdf_with_com(
    display_name: &str,
    prog_id: &str,
    xlsx_path: &PathBuf,
    pdf_path: &PathBuf,
) -> Result<(), String> {
    let _ = fs::remove_file(pdf_path);
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$app = $null
$workbook = $null
try {{
  $xlsxPath = '{}'
  $pdfPath = '{}'
  $app = New-Object -ComObject '{}'
  try {{ $app.Visible = $false }} catch {{}}
  try {{ $app.DisplayAlerts = $false }} catch {{}}
  try {{ $app.AskToUpdateLinks = $false }} catch {{}}
  try {{ $app.EnableEvents = $false }} catch {{}}
  try {{ $app.AutomationSecurity = 3 }} catch {{}}
  try {{
    $workbook = $app.Workbooks.Open($xlsxPath, 0, $true)
  }} catch {{
    $workbook = $app.Workbooks.Open($xlsxPath)
  }}
  try {{ $workbook.CheckCompatibility = $false }} catch {{}}
  $workbook.ExportAsFixedFormat(0, $pdfPath)
}} catch {{
  Write-Output $_.Exception.Message
  exit 1
}} finally {{
  if ($workbook -ne $null) {{ $workbook.Close($false) | Out-Null }}
  if ($app -ne $null) {{ $app.Quit() | Out-Null }}
  if ($workbook -ne $null) {{ [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }}
  if ($app -ne $null) {{ [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null }}
}}
"#,
        escape_powershell_single_quoted_path(xlsx_path),
        escape_powershell_single_quoted_path(pdf_path),
        escape_powershell_single_quoted_value(prog_id),
    );

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| format!("{display_name} 启动失败：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = format!("{}{}", stdout.trim(), stderr.trim());
        return Err(format!(
            "{display_name} 导出失败：{}",
            readable_detail(&detail)
        ));
    }

    if !pdf_path.exists() {
        return Err(format!("{display_name} 导出失败：未找到生成的 PDF 文件。"));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn convert_xlsx_to_pdf_with_libreoffice(
    xlsx_path: &PathBuf,
    pdf_path: &PathBuf,
) -> Result<(), String> {
    let soffice_path = find_libreoffice_executable()
        .ok_or_else(|| "LibreOffice 导出失败：未找到 soffice 可执行文件。".to_string())?;
    let output_dir = pdf_path
        .parent()
        .ok_or_else(|| "LibreOffice 导出失败：PDF 输出目录无效。".to_string())?;
    let _ = fs::remove_file(pdf_path);

    let output = Command::new(&soffice_path)
        .args([
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            &output_dir.to_string_lossy(),
            &xlsx_path.to_string_lossy(),
        ])
        .output()
        .map_err(|error| format!("LibreOffice 启动失败：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = format!("{}{}", stdout.trim(), stderr.trim());
        return Err(format!(
            "LibreOffice 导出失败：{}",
            readable_detail(&detail)
        ));
    }

    let generated_pdf_path = xlsx_path.with_extension("pdf");
    if generated_pdf_path != *pdf_path && generated_pdf_path.exists() {
        fs::rename(&generated_pdf_path, pdf_path)
            .map_err(|error| format!("LibreOffice 导出成功但重命名 PDF 失败：{error}"))?;
    }

    if !pdf_path.exists() {
        return Err("LibreOffice 导出失败：未找到生成的 PDF 文件。".into());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn find_libreoffice_executable() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("soffice.com"),
        PathBuf::from("soffice.exe"),
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.com"),
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.com"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
    ];

    candidates.into_iter().find(|candidate| {
        if candidate.is_absolute() {
            candidate.exists()
        } else {
            Command::new(candidate)
                .arg("--version")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        }
    })
}

fn readable_detail(detail: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        "未返回详细错误。".into()
    } else {
        format!("详细信息：{trimmed}")
    }
}

fn format_export_errors(errors: &[String]) -> String {
    if errors.is_empty() {
        String::new()
    } else {
        format!(" 尝试记录：{}", errors.join("；"))
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn convert_xlsx_to_pdf_legacy_mojibake_non_windows(
    _xlsx_path: &PathBuf,
    _pdf_path: &PathBuf,
) -> Result<(), String> {
    Err("当前系统暂不支持自动导出 PDF。".into())
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
fn convert_xlsx_to_pdf_legacy_mojibake(
    xlsx_path: &PathBuf,
    pdf_path: &PathBuf,
) -> Result<(), String> {
    let script = format!(
        r#"
$excel = $null
$workbook = $null
try {{
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open('{}')
  $workbook.ExportAsFixedFormat(0, '{}')
}} finally {{
  if ($workbook -ne $null) {{ $workbook.Close($false) | Out-Null }}
  if ($excel -ne $null) {{ $excel.Quit() | Out-Null }}
  if ($workbook -ne $null) {{ [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }}
  if ($excel -ne $null) {{ [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }}
}}
"#,
        escape_powershell_single_quoted_path(xlsx_path),
        escape_powershell_single_quoted_path(pdf_path),
    );

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "PDF 导出失败，请确认本机已安装 Microsoft Excel。{}{}",
            stdout, stderr
        ));
    }

    if !pdf_path.exists() {
        return Err("PDF 导出失败，未找到生成的 PDF 文件。".into());
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn convert_xlsx_to_pdf(_xlsx_path: &PathBuf, _pdf_path: &PathBuf) -> Result<(), String> {
    Err("当前系统暂不支持自动导出 PDF。".into())
}

fn escape_powershell_single_quoted_path(path: &PathBuf) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn escape_powershell_single_quoted_value(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
fn convert_xlsx_to_pdf_v2(xlsx_path: &PathBuf, pdf_path: &PathBuf) -> Result<(), String> {
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$excel = $null
$workbook = $null
try {{
  $xlsxPath = '{}'
  $pdfPath = '{}'
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.EnableEvents = $false
  try {{ $excel.AutomationSecurity = 3 }} catch {{}}
  $workbook = $excel.Workbooks.Open($xlsxPath, 0, $true, 5, '', '', $true)
  $workbook.CheckCompatibility = $false
  $workbook.ExportAsFixedFormat(0, $pdfPath)
}} catch {{
  Write-Error $_.Exception.Message
  exit 1
}} finally {{
  if ($workbook -ne $null) {{ $workbook.Close($false) | Out-Null }}
  if ($excel -ne $null) {{ $excel.Quit() | Out-Null }}
  if ($workbook -ne $null) {{ [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }}
  if ($excel -ne $null) {{ [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }}
}}
"#,
        escape_powershell_single_quoted_path(xlsx_path),
        escape_powershell_single_quoted_path(pdf_path),
    );

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| format!("PDF 导出失败：无法启动 Microsoft Excel。详细信息：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = format!("{}{}", stdout.trim(), stderr.trim());
        return Err(format!(
            "PDF 导出失败：无法通过 Microsoft Excel 导出文件。请确认 Excel 已安装且没有弹窗阻塞。{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!("详细信息：{detail}")
            }
        ));
    }

    if !pdf_path.exists() {
        return Err("PDF 导出失败：未找到生成的 PDF 文件。".into());
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn convert_xlsx_to_pdf_v2(_xlsx_path: &PathBuf, _pdf_path: &PathBuf) -> Result<(), String> {
    Err("当前系统暂不支持自动导出 PDF。".into())
}

#[tauri::command]
fn open_generated_contract(path: String) -> Result<(), String> {
    let contract_path = PathBuf::from(&path);
    if !contract_path.exists() {
        return Err(format!("文件不存在：{path}"));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn find_contract_template(app: &AppHandle) -> Result<PathBuf, String> {
    find_template(app, "Sales Contract Template.xlsx")
}

fn find_pi_template(app: &AppHandle) -> Result<PathBuf, String> {
    find_template(app, "PI Template.xlsx")
}

fn find_template(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let template_name = PathBuf::from("templates").join(filename);
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(&template_name));
        candidates.push(current_dir.join("..").join(&template_name));
    }

    if let Ok(path) = app
        .path()
        .resolve(&template_name, tauri::path::BaseDirectory::Resource)
    {
        candidates.push(path);
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(&template_name));
            candidates.push(exe_dir.join("_up_").join(&template_name));
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "{filename} not found in resource, executable, or project template directories"
    ))
}

fn replace_contract_placeholders(text: &str, fields: &HashMap<String, String>) -> String {
    let mut result = text.to_string();
    for (key, value) in fields {
        let placeholder = format!("{{{{{key}}}}}");
        result = result.replace(&placeholder, &escape_xml(value));
    }
    result
}

fn apply_trade_terms_replacements(text: &str, trade_terms: &str) -> String {
    if trade_terms != "FOB" {
        return text.to_string();
    }

    text.replace(
        "The Seller is responsible for ship chartering and space booking for cargo transportation.",
        "The Buyer is responsible for ship chartering and space booking for cargo transportation.",
    )
    .replace(
        "卖方负责货物运输的船舶租用和舱位预订。",
        "买方负责货物运输的船舶租用和舱位预订。",
    )
    .replace(
        "卖家负责货物运输的船舶租用和舱位预订。",
        "买家负责货物运输的船舶租用和舱位预订。",
    )
}

fn apply_pi_template_replacements(
    text: &str,
    fields: &HashMap<String, String>,
    name: &str,
) -> String {
    if name == "xl/worksheets/sheet1.xml" {
        let replacements = [("H7", "issue_date_serial"), ("J12", "expiry_date_serial")];
        let mut result = text.to_string();
        for (cell, key) in replacements {
            if let Some(value) = fields.get(key) {
                result = replace_numeric_cell_value_if_not_shared_string(&result, cell, value);
            }
        }
        return result;
    }

    text.to_string()
}

fn replace_numeric_cell_value_if_not_shared_string(
    text: &str,
    cell_ref: &str,
    value: &str,
) -> String {
    let cell_marker = format!(r#"<c r="{cell_ref}""#);
    let Some(cell_start) = text.find(&cell_marker) else {
        return text.to_string();
    };
    let Some(cell_end_relative) = text[cell_start..].find("</c>") else {
        return text.to_string();
    };
    let cell_end = cell_start + cell_end_relative + "</c>".len();
    let cell = &text[cell_start..cell_end];
    if cell.contains(r#"t="s""#) {
        return text.to_string();
    }

    replace_cell_value(text, cell_ref, value)
}

fn replace_cell_value(text: &str, cell_ref: &str, value: &str) -> String {
    let cell_marker = format!(r#"<c r="{cell_ref}""#);
    let Some(cell_start) = text.find(&cell_marker) else {
        return text.to_string();
    };
    let Some(cell_end_relative) = text[cell_start..].find("</c>") else {
        return text.to_string();
    };
    let cell_end = cell_start + cell_end_relative + "</c>".len();
    let cell = &text[cell_start..cell_end];
    let Some(value_start_relative) = cell.find("<v>") else {
        return text.to_string();
    };
    let value_start = value_start_relative + "<v>".len();
    let Some(value_end_relative) = cell[value_start..].find("</v>") else {
        return text.to_string();
    };
    let value_end = value_start + value_end_relative;
    let replacement_cell = format!(
        "{}{}{}",
        &cell[..value_start],
        escape_xml(value),
        &cell[value_end..],
    );

    format!(
        "{}{}{}",
        &text[..cell_start],
        replacement_cell,
        &text[cell_end..],
    )
}

fn decode_logo_data(value: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("empty logo data".into());
    }

    let encoded = trimmed
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(trimmed);
    general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>()
        .trim_matches('.')
        .to_string();

    if sanitized.is_empty() {
        "contract".into()
    } else {
        sanitized
    }
}

fn open_database(path: PathBuf) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(&path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, phone TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS companies (
              id INTEGER PRIMARY KEY AUTOINCREMENT, company_name_en TEXT NOT NULL, company_name_cn TEXT,
              address TEXT, bank_name_en TEXT, bank_name_cn TEXT, swift_code TEXT, usd_account TEXT,
              content TEXT, logo_data TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS customers (
              id INTEGER PRIMARY KEY AUTOINCREMENT, company_name_en TEXT NOT NULL, company_name_cn TEXT,
              address TEXT, phone TEXT, customer_type TEXT, country TEXT, country_cn TEXT, email TEXT, contact_person TEXT, ntn TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS customer_managers (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name_en TEXT NOT NULL, name_cn TEXT, hs_code TEXT,
              model TEXT, is_drug_precursor INTEGER NOT NULL DEFAULT 0, kgs_per_drum REAL, cas TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS ports (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name_en TEXT NOT NULL, name_cn TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS contract_terms (
              id INTEGER PRIMARY KEY AUTOINCREMENT, term_code TEXT NOT NULL, content_cn TEXT,
              content_en TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS term_configurations (
              id INTEGER PRIMARY KEY AUTOINCREMENT, config_no TEXT NOT NULL UNIQUE, config_date TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS term_configuration_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT, config_id INTEGER NOT NULL, item_code TEXT NOT NULL,
              term_id INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(config_id, item_code),
              FOREIGN KEY (config_id) REFERENCES term_configurations(id) ON DELETE CASCADE,
              FOREIGN KEY (term_id) REFERENCES contract_terms(id)
            );
            CREATE TABLE IF NOT EXISTS contracts (
              id INTEGER PRIMARY KEY AUTOINCREMENT, contract_no TEXT NOT NULL, issue_date TEXT,
              buyer_id INTEGER, seller_id INTEGER, product_id INTEGER, term_id INTEGER,
              term_configuration_id INTEGER, quantity REAL NOT NULL DEFAULT 0,
              unit_price REAL NOT NULL DEFAULT 0, advance_amount REAL NOT NULL DEFAULT 0,
              balance_amount REAL NOT NULL DEFAULT 0, destination_port TEXT, loading_port TEXT,
              trade_terms TEXT, expiry_date TEXT, palletized TEXT, customer_manager_id INTEGER,
              purchase_no TEXT, pi_expiry_date TEXT, drum_count REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (buyer_id) REFERENCES customers(id),
              FOREIGN KEY (seller_id) REFERENCES companies(id),
              FOREIGN KEY (product_id) REFERENCES products(id),
              FOREIGN KEY (term_id) REFERENCES contract_terms(id),
              FOREIGN KEY (term_configuration_id) REFERENCES term_configurations(id)
            );
            "#,
        )
        .map_err(|error| error.to_string())?;

    migrate_column(&connection, "contracts", "expiry_date", "TEXT")?;
    migrate_column(&connection, "contracts", "palletized", "TEXT")?;
    migrate_column(&connection, "contracts", "term_configuration_id", "INTEGER")?;
    migrate_column(&connection, "products", "cas", "TEXT")?;
    migrate_column(&connection, "customers", "country_cn", "TEXT")?;
    migrate_column(&connection, "customers", "customer_type", "TEXT")?;
    migrate_column(&connection, "companies", "logo_data", "TEXT")?;
    migrate_column(
        &connection,
        "term_configuration_items",
        "sort_order",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    migrate_column(&connection, "contracts", "customer_manager_id", "INTEGER")?;
    migrate_column(&connection, "contracts", "purchase_no", "TEXT")?;
    migrate_column(&connection, "contracts", "pi_expiry_date", "TEXT")?;
    migrate_column(
        &connection,
        "contracts",
        "drum_count",
        "REAL NOT NULL DEFAULT 0",
    )?;
    seed_database(&connection)?;

    Ok(connection)
}

fn migrate_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !names.contains(column) {
        connection
            .execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn seed_database(connection: &Connection) -> Result<(), String> {
    let product_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM products", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if product_count == 0 {
        connection
            .execute(
                "INSERT INTO users (name, email, phone) VALUES (?, ?, ?)",
                params!["Chris", "chris@zzyschemical.com", "Chris +86 18703600376"],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO companies (company_name_en, company_name_cn, address, bank_name_en, bank_name_cn, swift_code, usd_account, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "ZHENGZHOU YISHUN CHEMICAL LOGISTICS CO., LTD",
                    "郑州亿顺化工物流有限公司",
                    "KUNLUN ROAD NORTH SECTION, SHANGJIE DISTRICT, ZHENGZHOU CITY, HENAN, CHINA",
                    "BANK OF COMMUNICATIONS CO.,LTD.HENAN PROVINCIAL BRANCH",
                    "交通银行股份有限公司河南省分行",
                    "COMMCNSHZHE",
                    "411609999011000980542",
                    "Seller bank information: BANK OF COMMUNICATIONS CO.,LTD.HENAN PROVINCIAL BRANCH"
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO customers (company_name_en, company_name_cn, address, phone, customer_type, country, country_cn, email, contact_person, ntn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "DEXI CHEMICALS CO., LIMITED",
                    "德西化工有限公司",
                    "RM.1902 EASEY COMM. BLDG. 253-261 HENNESSY RD, WANCHAI,HONG KONG,CHINA",
                    "PHONE: +86 371 56035293",
                    "贸易商",
                    "Hong Kong",
                    "中国香港",
                    "info@zzyschemical.com",
                    "/",
                    "/"
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO products (name_en, name_cn, hs_code, model, is_drug_precursor, kgs_per_drum) VALUES (?, ?, ?, ?, ?, ?)",
                params!["METHYL ETHYL KETONE", "甲基乙基酮", "29141200", "0.997", 1, 165],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO contract_terms (term_code, content_cn, content_en) VALUES (?, ?, ?)",
                params![
                    "TERM-001",
                    "卖方收到买方预付款及办理出口许可证所需全部相关资料后二十个工作日内安排发货。",
                    "The Seller shall arrange shipment within 20 working days after receiving the advance payment from the Buyer and all relevant information required for the export license."
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    let defaults = [
        ("Lianyungang PORT, CHINA", "中国连云港港"),
        ("Qingdao PORT, CHINA", "中国青岛港"),
        ("Shanghai PORT, CHINA", "中国上海港"),
        ("Haiphong, VIETNAM", "越南海防港"),
    ];
    for (name_en, name_cn) in defaults {
        connection
            .execute(
                "INSERT INTO ports (name_en, name_cn) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM ports WHERE name_en = ?)",
                params![name_en, name_cn, name_en],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let database_path = data_dir.join("data").join("ys-documents.sqlite");
            app.manage(Database {
                connection: Mutex::new(None),
                path: database_path.to_string_lossy().into_owned(),
            });
            if let Some(window) = app.get_webview_window("main") {
                apply_native_titlebar_style(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_meta,
            db_list,
            db_create,
            db_update,
            db_delete_many,
            db_replace_term_configuration_items,
            generate_contract_pdf,
            generate_pi_pdf,
            generate_packing_list_pdf,
            generate_commercial_invoice_pdf,
            open_generated_contract
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
