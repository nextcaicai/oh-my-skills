use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return home_dir();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    if let Some(rest) = path.strip_prefix("~\\") {
        return home_dir().join(rest);
    }
    PathBuf::from(path)
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            let mut home = PathBuf::from(drive);
            home.push(path);
            Some(home)
        })
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| {
        format!(
            "Unable to create directory {}: {error}",
            path_to_string(path)
        )
    })
}

pub fn skill_slug_from_path(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| format!("Unable to infer skill slug from {}", path_to_string(path)))
}

pub fn hash_dir(path: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(path).follow_links(false).sort_by_file_name() {
        let entry =
            entry.map_err(|error| format!("Unable to walk {}: {error}", path_to_string(path)))?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }

    let mut hasher = Sha256::new();
    for file in files {
        let rel = file
            .strip_prefix(path)
            .map_err(|error| format!("Unable to hash {}: {error}", path_to_string(&file)))?;
        hasher.update(hash_relative_path(rel).as_bytes());
        hasher.update([0]);

        let mut handle = fs::File::open(&file)
            .map_err(|error| format!("Unable to read {}: {error}", path_to_string(&file)))?;
        let mut buffer = [0_u8; 8192];
        loop {
            let read = handle
                .read(&mut buffer)
                .map_err(|error| format!("Unable to read {}: {error}", path_to_string(&file)))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        hasher.update([0xff]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_relative_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "Source is not a directory: {}",
            path_to_string(source)
        ));
    }
    ensure_dir(destination)?;

    for entry in WalkDir::new(source).follow_links(false).sort_by_file_name() {
        let entry =
            entry.map_err(|error| format!("Unable to copy {}: {error}", path_to_string(source)))?;
        let rel = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| format!("Unable to copy {}: {error}", path_to_string(entry.path())))?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = destination.join(rel);
        if entry.file_type().is_dir() {
            ensure_dir(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                ensure_dir(parent)?;
            }
            fs::copy(entry.path(), &target).map_err(|error| {
                format!(
                    "Unable to copy {} to {}: {error}",
                    path_to_string(entry.path()),
                    path_to_string(&target)
                )
            })?;
        } else if entry.file_type().is_symlink() {
            let link_target = fs::read_link(entry.path()).map_err(|error| {
                format!(
                    "Unable to read symlink {}: {error}",
                    path_to_string(entry.path())
                )
            })?;
            create_symlink(&link_target, &target)?;
        }
    }

    Ok(())
}

pub fn move_path(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        ensure_dir(parent)?;
    }
    fs::rename(source, destination).map_err(|error| {
        format!(
            "Unable to move {} to {}: {error}",
            path_to_string(source),
            path_to_string(destination)
        )
    })
}

pub fn remove_entry(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Unable to inspect {}: {error}", path_to_string(path)))?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("Unable to remove {}: {error}", path_to_string(path)))
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Unable to remove {}: {error}", path_to_string(path)))
    } else {
        Err(format!(
            "Unsupported entry type at {}",
            path_to_string(path)
        ))
    }
}

#[cfg(unix)]
pub fn create_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        ensure_dir(parent)?;
    }
    std::os::unix::fs::symlink(source, destination).map_err(|error| {
        format!(
            "Unable to symlink {} to {}: {error}",
            path_to_string(destination),
            path_to_string(source)
        )
    })
}

#[cfg(windows)]
pub fn create_symlink(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        ensure_dir(parent)?;
    }
    let result = if source.is_dir() {
        std::os::windows::fs::symlink_dir(source, destination)
    } else {
        std::os::windows::fs::symlink_file(source, destination)
    };
    result.map_err(|error| {
        format!(
            "Unable to symlink {} to {}: {error}. On Windows, enable Developer Mode or run Oh My Skills as administrator, or use Copy instead.",
            path_to_string(destination),
            path_to_string(source)
        )
    })
}

#[cfg(not(any(unix, windows)))]
pub fn create_symlink(_source: &Path, _destination: &Path) -> Result<(), String> {
    Err("Symlink sync is not implemented for this operating system".to_string())
}

#[cfg(windows)]
pub fn symlink_unavailable_message() -> Option<String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let probe_root = std::env::temp_dir().join(format!("oh-my-skills-symlink-probe-{suffix}"));
    let source = probe_root.join("source");
    let link = probe_root.join("link");

    let result = (|| -> Result<(), String> {
        ensure_dir(&source)?;
        std::os::windows::fs::symlink_dir(&source, &link).map_err(|error| {
            format!(
                "Symlink sync is unavailable on this Windows machine: {error}. Enable Windows Developer Mode or run Oh My Skills as administrator, then preview again. You can use Copy migration instead."
            )
        })?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(&probe_root);
    result.err()
}

#[cfg(not(windows))]
pub fn symlink_unavailable_message() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn folder_hash_changes_when_file_changes() {
        let temp = tempfile::tempdir().expect("temp dir");
        fs::write(temp.path().join("SKILL.md"), "one").expect("write one");
        let first = hash_dir(temp.path()).expect("first hash");
        fs::write(temp.path().join("SKILL.md"), "two").expect("write two");
        let second = hash_dir(temp.path()).expect("second hash");
        assert_ne!(first, second);
    }

    #[test]
    fn expands_backslash_home_prefix() {
        let expected = home_dir().join("skills");
        assert_eq!(expand_home("~\\skills"), expected);
    }

    #[test]
    fn hash_paths_use_forward_slashes() {
        let path = PathBuf::from("one").join("two").join("SKILL.md");
        assert_eq!(hash_relative_path(&path), "one/two/SKILL.md");
    }

    #[test]
    fn removes_files_and_directories() {
        let temp = tempfile::tempdir().expect("temp dir");
        let file = temp.path().join("file.txt");
        let dir = temp.path().join("dir");
        fs::write(&file, "data").expect("write file");
        fs::create_dir_all(&dir).expect("create dir");

        remove_entry(&file).expect("remove file");
        remove_entry(&dir).expect("remove dir");

        assert!(!file.exists());
        assert!(!dir.exists());
    }
}
