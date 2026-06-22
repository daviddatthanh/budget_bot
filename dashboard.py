import streamlit as st
import pandas as pd
import plotly.express as px
import os
import re
from parsers.base_parser import clean_bank_csv

# --- Configuration & Paths ---
st.set_page_config(page_title="Financial Command Center", layout="wide")
MASTER_DB_PATH = "data/master_transactions.csv"
CATEGORIES_PATH = "data/user_categories.csv"
RULES_PATH = "data/merchant_rules.csv"
EXCEL_HISTORY_PATH = "2025 V2 - Copy.xlsx - Budget Tracking.csv"

# --- Inject SaaS CSS Aesthetics ---
st.markdown("""
<style>
    /* Floating Card Layouts */
    .css-1r6slb0, .css-18e3th9 {
        background-color: #ffffff;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        border: 1px solid #e5e7eb;
    }
    /* Typography */
    html, body, [class*="css"]  {
        font-family: 'Inter', sans-serif;
    }
    /* Top Metric Bar Styling */
    div[data-testid="metric-container"] {
        background-color: #f8fafc;
        border-radius: 8px;
        padding: 15px;
        border: 1px solid #e2e8f0;
    }
</style>
""", unsafe_allow_html=True)

# --- State Management (Fixes the Tab Switching Bug) ---
if 'master_df' not in st.session_state:
    if os.path.exists(MASTER_DB_PATH):
        st.session_state.master_df = pd.read_csv(MASTER_DB_PATH)
        st.session_state.master_df['Date'] = pd.to_datetime(st.session_state.master_df['Date'], errors='coerce')
    else:
        st.session_state.master_df = pd.DataFrame(columns=['Transaction_ID', 'Date', 'Description', 'Amount', 'Category', 'Person'])

if 'cat_df' not in st.session_state:
    if os.path.exists(CATEGORIES_PATH):
        df = pd.read_csv(CATEGORIES_PATH)
        if 'Type' not in df.columns:
            df['Type'] = 'Expense'
        st.session_state.cat_df = df
    else:
        st.session_state.cat_df = pd.DataFrame({
            'Category': ['Salary', 'Dining', 'Groceries', 'Investments', 'Uncategorized'],
            'Type': ['Income', 'Expense', 'Expense', 'Savings', 'Expense']
        })

# --- Core Logic Functions ---
def extract_core_merchant(desc):
    if pd.isna(desc): return "UNKNOWN"
    clean = re.sub(r'(?i)null\s*[X\d]+|#\s*\d+|[*\d]+', ' ', str(desc))
    noise = r'\b(IN|CA|MI|NY|TX|FL|MD|MT|OR|WA|NV|CLEARED|PENDING|TROY|IRVINE)\b'
    clean = re.sub(noise, ' ', clean, flags=re.IGNORECASE)
    clean = re.sub(r'[^A-Z\s]', ' ', clean.upper())
    words = clean.split()
    return " ".join(words[:3]) if len(words) >= 3 else " ".join(words)

# --- Header & Navigation ---
st.title("Financial Command Center")
tab_dash, tab_upload, tab_categorize, tab_settings = st.tabs(["📊 Executive Dashboard", "📥 Data Pipeline", "🧠 AI Ledger", "⚙️ Taxonomy"])

df = st.session_state.master_df.copy()

# ==========================================
# TAB 1: EXECUTIVE DASHBOARD
# ==========================================
with tab_dash:
    if df.empty:
        st.info("Awaiting Data. Proceed to the Data Pipeline tab to upload CSVs.")
    else:
        col_f1, col_f2 = st.columns(2)
        df['YearMonth'] = df['Date'].dt.to_period('M').astype(str)
        selected_month = col_f1.selectbox("Reporting Period", ["All Time"] + sorted(list(df['YearMonth'].unique()), reverse=True))
        selected_person = col_f2.selectbox("Profile", ["All Users"] + list(df['Person'].unique()) if 'Person' in df.columns else ["All Users"])

        f_df = df.copy()
        if selected_month != "All Time": f_df = f_df[f_df['YearMonth'] == selected_month]
        if selected_person != "All Users" and 'Person' in f_df.columns: f_df = f_df[f_df['Person'] == selected_person]

        type_map = dict(zip(st.session_state.cat_df['Category'], st.session_state.cat_df['Type']))
        f_df['Type_Class'] = f_df['Category'].map(type_map).fillna('Expense')

        f_df.loc[f_df['Type_Class'] == 'Expense', 'Amount'] = f_df['Amount'].abs() * -1
        f_df.loc[f_df['Type_Class'].isin(['Income', 'Savings']), 'Amount'] = f_df['Amount'].abs()

        inc = f_df[f_df['Type_Class'] == 'Income']['Amount'].sum()
        exp = f_df[f_df['Type_Class'] == 'Expense']['Amount'].sum() * -1
        sav = f_df[f_df['Type_Class'] == 'Savings']['Amount'].sum()

        k1, k2, k3, k4 = st.columns(4)
        k1.metric("Income", f"${inc:,.2f}")
        k2.metric("Expenses", f"${exp:,.2f}")
        k3.metric("Savings", f"${sav:,.2f}")
        k4.metric("Savings Rate %", f"{(sav/inc*100) if inc > 0 else 0:.1f}%")

        st.markdown("---")
        c1, c2, c3 = st.columns(3)
        with c1:
            st.markdown("#### 🔴 Expenses")
            st.plotly_chart(px.pie(f_df[f_df['Type_Class'] == 'Expense'], values=f_df['Amount'].abs(), names='Category', hole=0.6, color_discrete_sequence=['#ef4444']), use_container_width=True)
        with c2:
            st.markdown("#### 🟢 Income")
            st.plotly_chart(px.pie(f_df[f_df['Type_Class'] == 'Income'], values='Amount', names='Category', hole=0.6, color_discrete_sequence=['#22c55e']), use_container_width=True)
        with c3:
            st.markdown("#### 🔵 Savings")
            st.plotly_chart(px.pie(f_df[f_df['Type_Class'] == 'Savings'], values='Amount', names='Category', hole=0.6, color_discrete_sequence=['#3b82f6']), use_container_width=True)

# ==========================================
# TAB 2: DATA PIPELINE (Ingestion)
# ==========================================
with tab_upload:
    st.subheader("Data Pipeline (Upload & Process)")
    u_person = st.text_input("Profile Name", value="Primary User")
    
    # Simulating the Drag & Drop Bucket logic
    u_bucket = st.radio("Select Target Bucket:", ["Banking (Checking/Savings)", "Credit Card (Liabilities)"], horizontal=True)
    uploaded_files = st.file_uploader("Drop CSV files here", accept_multiple_files=True)

    if st.button("Process Files"):
        if uploaded_files:
            new_records = []
            for f in uploaded_files:
                # Save uploaded file temporarily to use the existing parser
                temp_path = f"temp_{f.name}"
                with open(temp_path, "wb") as file_out: file_out.write(f.getbuffer())
                
                try:
                    # Leverage your existing robust parser from parsers/base_parser.py
                    parsed_df = clean_bank_csv(temp_path)
                    parsed_df['Person'] = u_person
                    parsed_df['Category'] = 'Uncategorized'
                    
                    # Flip sign if it's a credit card liability
                    if "Credit Card" in u_bucket:
                        parsed_df['Amount'] = parsed_df['Amount'].abs() * -1
                        
                    new_records.append(parsed_df)
                except Exception as e:
                    st.error(f"Failed to parse {f.name}: {e}")
                finally:
                    if os.path.exists(temp_path): os.remove(temp_path)
            
            if new_records:
                st.session_state.master_df = pd.concat(new_records + [st.session_state.master_df]).drop_duplicates(subset=['Transaction_ID'])
                st.session_state.master_df.to_csv(MASTER_DB_PATH, index=False)
                st.success("Files processed and committed to Master Database.")
                st.rerun()

# ==========================================
# TAB 3: AI LEDGER (Smart Categorizer)
# ==========================================
with tab_categorize:
    st.subheader("Validation Ledger")
    if st.button("Run Excel History Sync (Budget Tracking.csv)"):
        if os.path.exists(EXCEL_HISTORY_PATH):
            hist = pd.read_csv(EXCEL_HISTORY_PATH, skiprows=11)
            hist.columns = [c.strip() for c in hist.columns]
            hist_map = dict(zip(hist['Details'].apply(extract_core_merchant), hist['Categories']))
            
            mask = st.session_state.master_df['Category'] == 'Uncategorized'
            st.session_state.master_df.loc[mask, 'Category'] = st.session_state.master_df.loc[mask, 'Description'].apply(extract_core_merchant).map(hist_map).fillna('Uncategorized')
            st.session_state.master_df.to_csv(MASTER_DB_PATH, index=False)
            st.success("Ledger synced with historical records.")
            st.rerun()
        else:
            st.error("Budget Tracking.csv not found in the root directory.")

    uncat = st.session_state.master_df[st.session_state.master_df['Category'] == 'Uncategorized'].copy()
    if not uncat.empty:
        uncat['Group_Key'] = uncat['Description'].apply(extract_core_merchant)
        groups = uncat.groupby('Group_Key').agg({'Amount': 'sum', 'Description': 'count'}).reset_index()
        groups['Assign_Category'] = 'Uncategorized'
        
        st.markdown("Assign categories below. Rows with assigned values will be committed.")
        edited = st.data_editor(groups, column_config={"Assign_Category": st.column_config.SelectboxColumn("Category", options=st.session_state.cat_df['Category'].tolist())}, hide_index=True)
        
        if st.button("Commit Ledger Changes"):
            for _, row in edited[edited['Assign_Category'] != 'Uncategorized'].iterrows():
                mask = st.session_state.master_df['Description'].apply(extract_core_merchant) == row['Group_Key']
                st.session_state.master_df.loc[mask, 'Category'] = row['Assign_Category']
            st.session_state.master_df.to_csv(MASTER_DB_PATH, index=False)
            st.rerun()
    else:
        st.success("All records are verified and categorized.")

# ==========================================
# TAB 4: TAXONOMY (Settings)
# ==========================================
with tab_settings:
    st.subheader("Taxonomy Configuration")
    edited_cats = st.data_editor(st.session_state.cat_df, num_rows="dynamic", use_container_width=True)
    if st.button("Update Taxonomy Engine"):
        edited_cats.to_csv(CATEGORIES_PATH, index=False)
        st.session_state.cat_df = edited_cats
        st.success("Categories updated successfully.")
        st.rerun()