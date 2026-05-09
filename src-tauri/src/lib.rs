use tauri::{AppHandle, Emitter, Manager};
use std::thread;

#[derive(serde::Serialize, Clone)]
struct KeyEventPayload {
    key: String,
    event_type: String,
}

fn rdev_key_to_string(key: rdev::Key) -> String {
    format!("{:?}", key)
}

fn start_rdev_listener(app: AppHandle) {
    thread::spawn(move || {
        #[cfg(target_os = "macos")]
        rdev::set_is_main_thread(false);

        if let Err(error) = rdev::listen(move |event| {
            let event_type = match event.event_type {
                rdev::EventType::KeyPress(key) => Some(("keydown", key)),
                rdev::EventType::KeyRelease(key) => Some(("keyup", key)),
                _ => None,
            };

            if let Some((type_str, key)) = event_type {
                let payload = KeyEventPayload {
                    key: rdev_key_to_string(key),
                    event_type: type_str.to_string(),
                };
                let _ = app.emit("global-key-event", payload);
            }
        }) {
            eprintln!("rdev error: {:?}", error);
        }
    });
}

#[tauri::command]
async fn toggle_overlay(app: AppHandle, active: bool) -> Result<(), String> {
    if active {
        if app.get_webview_window("overlay").is_none() {
            let _overlay = tauri::WebviewWindowBuilder::new(
                &app,
                "overlay",
                tauri::WebviewUrl::App("index.html#/overlay".into()),
            )
            .title("KeyViewer Overlay")
            .inner_size(400.0, 300.0)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?;
        }
    } else {
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.close();
        }
    }
    Ok(())
}

#[tauri::command]
async fn get_screen_size(app: AppHandle) -> Result<(u32, u32), String> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            return Ok((size.width, size.height));
        }
    }
    Ok((1920, 1080))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            start_rdev_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toggle_overlay, get_screen_size])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
