import os
import shutil
import pandas as pd
import sys

# Ensure UTF-8 output encoding to prevent UnicodeEncodeError on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from parsers.base_parser import clean_bank_csv
from core.categorizer import train_categorizer, categorize_data

# --- Directory Configuration ---
DATA_ROOT = "data"
USER_ROOT = os.path.join(DATA_ROOT, "users")
MASTER_DB_PATH = os.path.join(DATA_ROOT, "master_transactions.csv")

def setup_person_dirs(person_name):
    """Ensures subdirectories exist for each person found in the users folder."""
    paths = [
        os.path.join(USER_ROOT, person_name, "raw/banking"),
        os.path.join(USER_ROOT, person_name, "raw/credit_cards"),
        os.path.join(USER_ROOT, person_name, "archive")
    ]
    for p in paths:
        os.makedirs(p, exist_ok=True)

def run_pipeline():
    """Main execution engine: Ingests, Categorizes, and Deduplicates."""
    
    # 1. Initialize the AI 'Brain'
    print("🤖 Training AI Categorizer on historical data...")
    ai_model = train_categorizer()
    
    # 2. Load Master Database
    if os.path.exists(MASTER_DB_PATH):
        master_df = pd.read_csv(MASTER_DB_PATH)
    else:
        # Include 'Category' and 'Person' columns for the new database
        master_df = pd.DataFrame(columns=['Transaction_ID', 'Date', 'Description', 'Amount', 'Category', 'Person'])
        
    initial_count = len(master_df)
    new_data_frames = []

    # 3. Scan for People Folders inside users root
    if not os.path.exists(USER_ROOT):
        os.makedirs(USER_ROOT)
        print("Users root created. Please add person folders (e.g., 'big_boo').")
        return

    people = [d for d in os.listdir(USER_ROOT) if os.path.isdir(os.path.join(USER_ROOT, d))]

    for person in people:
        print(f"\n--- Processing Profile: {person} ---")
        setup_person_dirs(person)
        
        person_raw_root = os.path.join(USER_ROOT, person, "raw")
        
        for subfolder in ['banking', 'credit_cards']:
            folder_path = os.path.join(person_raw_root, subfolder)
            if not os.path.exists(folder_path):
                continue
                
            for file in os.listdir(folder_path):
                if file.lower().endswith('.csv'):
                    filepath = os.path.join(folder_path, file)
                    
                    try:
                        print(f"📄 Standardizing: {file}")
                        # Step A: Clean and standardize headers
                        clean_df = clean_bank_csv(filepath)
                        
                        # Step B: AI Categorization
                        print(f"🧠 AI Categorizing transactions for {file}...")
                        clean_df = categorize_data(clean_df, ai_model)
                        
                        # Step C: Tag Person and Account Name
                        clean_df['Person'] = person
                        
                        # Intelligently extract card/account name from filename (e.g. Amex_Gold.csv -> Amex Gold)
                        account_name = os.path.splitext(file)[0].replace('_', ' ').replace('-', ' ').title()
                        clean_df['Account'] = account_name
                        
                        new_data_frames.append(clean_df)
                        
                        # Step D: Archive the file using Gzip compression to save space
                        import gzip
                        archive_path = os.path.join(USER_ROOT, person, "archive", file + ".gz")
                        with open(filepath, 'rb') as f_in:
                            with gzip.open(archive_path, 'wb') as f_out:
                                shutil.copyfileobj(f_in, f_out)
                        os.remove(filepath)
                        
                    except Exception as e:
                        print(f"❌ Error processing {file}: {e}")

    # 4. Final Consolidation and Deduplication
    if new_data_frames:
        combined_new = pd.concat(new_data_frames, ignore_index=True)
        master_df = pd.concat([master_df, combined_new], ignore_index=True)
        
        # Deduplicate based on ID + Person
        master_df.drop_duplicates(subset=['Transaction_ID', 'Person'], keep='first', inplace=True)
        master_df.sort_values(by='Date', ascending=False, inplace=True)
        
        master_df.to_csv(MASTER_DB_PATH, index=False)
        
        added = len(master_df) - initial_count
        print(f"\n✅ Success! Added {added} new unique transactions.")
        print(f"📊 Database now contains {len(master_df)} total records.")
    else:
        print("\n📭 No new files found to process.")

if __name__ == "__main__":
    run_pipeline()