import pandas as pd
import os
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

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import make_pipeline

MASTER_DB_PATH = "data/master_transactions.csv"

def train_categorizer():
    """Retrains the AI based on the current state of the Master Database."""
    if not os.path.exists(MASTER_DB_PATH):
        print("ℹ️ No historical data found yet. AI is in 'Observation Mode'.")
        return None
        
    df = pd.read_csv(MASTER_DB_PATH)
    
    if 'Category' not in df.columns:
        return None
        
    train_df = df[df['Category'] != 'Uncategorized'].dropna(subset=['Category', 'Description'])
    
    if len(train_df) < 5:
        print("ℹ️ AI needs at least 5 manually categorized examples to start 'thinking'.")
        return None

    model = make_pipeline(TfidfVectorizer(ngram_range=(1, 2)), MultinomialNB())
    model.fit(train_df['Description'], train_df['Category'])
    
    print(f"🧠 AI Updated: Learned from {len(train_df)} transactions.")
    return model

def categorize_data(df, model):
    """Predicts categories; if no model exists, marks as Uncategorized."""
    if model is None:
        df['Category'] = 'Uncategorized'
        df['AI_Confidence'] = 0.0
    else:
        df['Category'] = model.predict(df['Description'])
        probs = model.predict_proba(df['Description'])
        df['AI_Confidence'] = probs.max(axis=1).round(2)
    return df