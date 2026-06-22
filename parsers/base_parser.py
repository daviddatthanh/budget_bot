import pandas as pd
import io
import os
import hashlib

def generate_transaction_id(row):
    """Creates a unique hash based on the core transaction details."""
    unique_string = f"{row['Date']}_{row['Description']}_{row['Amount']}"
    return hashlib.md5(unique_string.encode('utf-8')).hexdigest()

def clean_bank_csv(filepath):
    """
    Reads any bank CSV, standardizes columns, adjusts signs based on 
    account type, and generates a unique ID for deduplication.
    """
    # 1. Bypass Junk Rows
    with open(filepath, 'r', encoding='utf-8', errors='replace') as file:
        lines = file.readlines()
        
    header_index = 0
    for i, line in enumerate(lines[:30]):
        line_lower = line.lower()
        if sum(keyword in line_lower for keyword in ['date', 'amount', 'description', 'debit', 'credit', 'note']) >= 2:
            header_index = i
            break
            
    # Strip trailing commas from each line to prevent column misalignment.
    # Chase checking CSVs have trailing commas on data rows (e.g. "67.08,,"),
    # creating more fields than headers, which makes pandas treat the first
    # data field as the row index and shift all columns by one position.
    cleaned_lines = []
    for line in lines[header_index:]:
        cleaned_lines.append(line.rstrip().rstrip(',') + '\n')
    df = pd.read_csv(io.StringIO(''.join(cleaned_lines)))
    
    # 2. Universal Column Synonyms
    column_synonyms = {
        'Date': ['date', 'trans date', 'transaction date', 'posting date', 'datetime', 'trans. date'],
        'Description': ['description', 'payee', 'note', 'name', 'merchant', 'details'],
        'Amount': ['amount', 'amount (total)'],
        'Debit': ['debit'],
        'Credit': ['credit']
    }
    
    matching_map = {synonym: standard for standard, synonyms in column_synonyms.items() for synonym in synonyms}

    # 3. Rename Columns Intelligently
    # Two passes so an exact standard name (e.g. a real "Description" column) always
    # wins its slot, and a mere synonym (e.g. Chase checking's "Details" = DEBIT/CREDIT
    # indicator) can't shadow it and create a duplicate column.
    standard_names = list(column_synonyms.keys())
    new_columns = {}
    claimed = set()

    # Pass 1: columns whose cleaned name already equals a standard name claim that slot.
    for col in df.columns:
        col_clean = str(col).lower().strip()
        for standard in standard_names:
            if col_clean == standard.lower() and standard not in claimed:
                new_columns[col] = standard
                claimed.add(standard)
                break

    # Pass 2: remaining columns map via synonyms, but only into still-unclaimed slots.
    for col in df.columns:
        if col in new_columns:
            continue
        col_clean = str(col).lower().strip()
        standard = matching_map.get(col_clean)
        if standard and standard not in claimed:
            new_columns[col] = standard
            claimed.add(standard)

    df.rename(columns=new_columns, inplace=True)
    
    # 4. Consolidate Split Debit/Credit Columns
    if 'Amount' not in df.columns and 'Debit' in df.columns and 'Credit' in df.columns:
        debit = pd.to_numeric(df['Debit'].astype(str).str.replace(r'[$,]', '', regex=True), errors='coerce').fillna(0)
        credit = pd.to_numeric(df['Credit'].astype(str).str.replace(r'[$,]', '', regex=True), errors='coerce').fillna(0)
        df['Amount'] = credit - debit
            
    # 5. Final Validation, Sign Adjustment, and Hashing
    if set(['Date', 'Description', 'Amount']).issubset(df.columns):
        df['Amount'] = pd.to_numeric(df['Amount'].astype(str).str.replace(r'[$,]', '', regex=True), errors='coerce')
        df = df.dropna(subset=['Date', 'Amount'])
        
        # Standardize Dates
        df['Date'] = pd.to_datetime(df['Date'], errors='coerce').dt.strftime('%Y-%m-%d')
        
        # Adjust Signs: Credit card files show expenses as positive. We multiply by -1.
        # Ensure your folder structure strictly uses "credit_cards" or "banking"
        normalized_path = filepath.lower().replace('\\', '/')
        if 'credit_cards' in normalized_path:
            # If the amount is positive (an expense on a CC), make it negative. 
            # If it's negative (a payment made to the CC), make it positive.
            df['Amount'] = df['Amount'] * -1
            
        # Generate Unique Transaction IDs
        df['Transaction_ID'] = df.apply(generate_transaction_id, axis=1)
        
        # Drop duplicates within the file itself before returning
        df = df.drop_duplicates(subset=['Transaction_ID'])
        
        return df[['Transaction_ID', 'Date', 'Description', 'Amount']]
    else:
        raise ValueError(f"Failed to standardize {filepath}. Extracted columns: {list(df.columns)}")

if __name__ == "__main__":
    # Example usage
    sample_file = "data/raw/credit_cards/Discover-RecentActivity-20260202.csv"
    if os.path.exists(sample_file):
        clean_data = clean_bank_csv(sample_file)
        print(clean_data.head())