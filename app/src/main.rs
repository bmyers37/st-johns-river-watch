//! St. Johns River Watch launcher.
//!
//! The dashboard itself is a web app (React + MapLibre) served by a small Node.js server. This
//! launcher makes it a double-clickable program:
//!   (no options)              build if needed, start the server, open the browser
//!   --screenshot <file.png>   render the app in headless Chrome/Edge and save a picture
//!   --self-test <file.json>   drive the app (pan the map, open a station, read the dashboard)
//!   --port <n>                use another port (default 5179)

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime};

fn app_dir() -> PathBuf {
    // Prefer the folder (above the executable) that holds the web app; fall back to where it was built.
    if let Ok(exe) = env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            if d.join("package.json").exists() && d.join("server").is_dir() {
                return d;
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn tool(name: &str) -> Command {
    // npm is a .cmd script on Windows, so it has to go through cmd.exe
    if cfg!(windows) && name == "npm" {
        let mut c = Command::new("cmd");
        c.args(["/C", "npm"]);
        c
    } else {
        Command::new(name)
    }
}

fn newest(path: &Path) -> SystemTime {
    let mut best = SystemTime::UNIX_EPOCH;
    if let Ok(entries) = fs::read_dir(path) {
        for e in entries.flatten() {
            let p = e.path();
            let t = if p.is_dir() {
                newest(&p)
            } else if p.extension().map_or(false, |x| x != "rs") {
                e.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH)
            } else {
                SystemTime::UNIX_EPOCH
            };
            if t > best {
                best = t;
            }
        }
    }
    best
}

fn modified(p: &Path) -> Option<SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Installs packages and builds the web app when it is missing or older than its sources.
fn ensure_built(dir: &Path) -> Result<(), String> {
    if Command::new("node").arg("--version").stdout(Stdio::null()).status().is_err() {
        return Err("Node.js is not installed. Download the free LTS version from https://nodejs.org and try again.".into());
    }
    if !dir.join("node_modules").is_dir() {
        println!("Installing components (first run)...");
        let ok = tool("npm").args(["install", "--no-fund", "--no-audit"]).current_dir(dir).status().map_err(|e| e.to_string())?;
        if !ok.success() {
            return Err("npm install failed".into());
        }
    }
    let sources = newest(&dir.join("src")).max(newest(&dir.join("server")));
    let built = match (modified(&dir.join("dist").join("index.html")), modified(&dir.join("dist-server").join("index.js"))) {
        (Some(a), Some(b)) => Some(a.min(b)),
        _ => None,
    };
    if built.map_or(true, |b| b < sources) {
        println!("Building the app...");
        let ok = tool("npm").args(["run", "build"]).current_dir(dir).status().map_err(|e| e.to_string())?;
        if !ok.success() {
            return Err("The build failed (see messages above).".into());
        }
    }
    Ok(())
}

fn healthy(port: u16) -> bool {
    let Ok(mut s) = TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(500)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let req = format!("GET /api/health HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 200") && buf.contains("St. Johns River Watch")
}

fn open_browser(url: &str) {
    let _ = if cfg!(windows) {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
}

fn absolute(p: &str) -> PathBuf {
    let p = PathBuf::from(p);
    if p.is_absolute() {
        p
    } else {
        env::current_dir().unwrap_or_default().join(p)
    }
}

fn run_capture(dir: &Path, mode: &str, file: &str) -> ExitCode {
    if let Err(e) = ensure_built(dir) {
        eprintln!("{e}");
        return ExitCode::FAILURE;
    }
    let status = Command::new("node").arg(dir.join("scripts").join("capture.mjs")).arg(mode).arg(absolute(file)).current_dir(dir).status();
    match status {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("could not start node: {e}");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let dir = app_dir();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();

    if let Some(file) = value("--screenshot") {
        return run_capture(&dir, "screenshot", &file);
    }
    if let Some(file) = value("--self-test") {
        return run_capture(&dir, "self-test", &file);
    }

    let port: u16 = value("--port").and_then(|p| p.parse().ok()).unwrap_or(5179);
    let url = format!("http://127.0.0.1:{port}");
    println!("\n  St. Johns River Watch\n  ---------------------\n");
    if healthy(port) {
        println!("  Already running - opening {url}");
        open_browser(&url);
        return ExitCode::SUCCESS;
    }
    if let Err(e) = ensure_built(&dir) {
        eprintln!("  {e}");
        let _ = std::io::stdin().read(&mut [0u8]);
        return ExitCode::FAILURE;
    }
    let mut server = match Command::new("node").arg(dir.join("dist-server").join("index.js")).env("PORT", port.to_string()).current_dir(&dir).spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("  could not start node: {e}");
            return ExitCode::FAILURE;
        }
    };
    let start = Instant::now();
    while !healthy(port) && start.elapsed() < Duration::from_secs(20) {
        sleep(Duration::from_millis(250));
    }
    open_browser(&url);
    match server.wait() {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        _ => ExitCode::FAILURE,
    }
}
