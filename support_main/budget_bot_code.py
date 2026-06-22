import os

# --- SETTINGS ---
ROOT_FILES = ["main.py", "dashboard.py"]
TARGET_FOLDERS = ["core", "parsers", "frontend"]
IGNORE_EXTENSIONS = [".csv", ".xlsx", ".pkl", ".pyc", ".json", ".h5", ".keras"]
OUTPUT_FILE = "budget_bot_code.txt"

HIDE_FOLDERS = [".git", ".venv", "__pycache__", ".vscode", "support_main"]
SKIP_CONTENTS_FOLDERS = ["data"]

def generate_directory_structure(base_dir):
    tree = ["=== PROJECT DIRECTORY STRUCTURE ==="]
    
    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d not in HIDE_FOLDERS]
        
        rel_path = os.path.relpath(root, base_dir)
        level = 0 if rel_path == "." else len(rel_path.split(os.sep))
        indent = "    " * level
        
        if rel_path != ".":
            folder_name = os.path.basename(root)
            tree.append(f"{indent}📁 {folder_name}/")
            
            if folder_name in SKIP_CONTENTS_FOLDERS:
                tree.append(f"{indent}    *(contents hidden)*")
                dirs[:] = []  
                continue      
        
        valid_files = sorted([f for f in files if not any(f.endswith(ext) for ext in IGNORE_EXTENSIONS)])
        for file in valid_files:
            if file == OUTPUT_FILE or file == os.path.basename(__file__):
                continue
            file_indent = indent if rel_path == "." else indent + "    "
            tree.append(f"{file_indent}📄 {file}")
            
    return "\n".join(tree) + "\n"

def export_project():
    # FAILSAFE: If run from 'support_main', step up one level to 'budget_bot'
    current_dir = os.path.abspath(os.path.dirname(__file__))
    if os.path.basename(current_dir) == "support_main":
        base_dir = os.path.dirname(current_dir)
    else:
        base_dir = current_dir
        
    output_path = os.path.join(base_dir, OUTPUT_FILE)
    
    with open(output_path, "w", encoding="utf-8") as out:
        out.write(f"=== PROJECT CODE EXPORT: {base_dir} ===\n\n")
        
        dir_structure = generate_directory_structure(base_dir)
        out.write(dir_structure)
        out.write("\n" + "="*50 + "\n")

        for f_name in ROOT_FILES:
            f_path = os.path.join(base_dir, f_name)
            if os.path.exists(f_path):
                out.write(f"\n\n=== TOP LEVEL FILE: {f_name} ===\n")
                try:
                    with open(f_path, "r", encoding="utf-8", errors="ignore") as f:
                        for i, line in enumerate(f, 1):
                            out.write(f"{i:4} | {line}")
                except Exception as e:
                    out.write(f"Error reading file: {e}\n")

        for folder in TARGET_FOLDERS:
            folder_path = os.path.join(base_dir, folder)
            if os.path.exists(folder_path):
                out.write(f"\n\n=== FOLDER: {folder} ===\n")
                
                for root, dirs, files in os.walk(folder_path):
                    if "__pycache__" in dirs:
                        dirs.remove("__pycache__")
                        
                    for file in files:
                        if any(file.endswith(ext) for ext in IGNORE_EXTENSIONS):
                            continue
                            
                        full_path = os.path.join(root, file)
                        relative_path = os.path.relpath(full_path, base_dir)
                        
                        out.write(f"\n--- FILE: {relative_path} ---\n")
                        try:
                            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                                for i, line in enumerate(f, 1):
                                    out.write(f"{i:4} | {line}")
                        except Exception as e:
                            out.write(f"Error reading file: {e}\n")

    print(f"✅ Project successfully exported to {output_path}")

if __name__ == "__main__":
    export_project()