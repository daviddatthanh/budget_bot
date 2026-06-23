import React, { useState, useEffect, useId, useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar
} from 'recharts';
import {
  UploadCloud, AlertCircle, RefreshCw, Trash2,
  Plus, DollarSign, TrendingUp, TrendingDown, CreditCard,
  Sparkles, AlertTriangle, Lightbulb, CheckCircle2, ListFilter, X,
  Landmark, Activity, Sun, Moon, Search, Repeat, CalendarClock, Info,
  ShieldCheck, ChevronRight, Wand2, LayoutDashboard, Settings as SettingsIcon,
  SlidersHorizontal, ArrowDownUp, ArrowUpRight, ArrowDownRight, BarChart3,
  FileText, Database, CheckCircle, Copy, Layers, Link2, Building2, Unlink, KeyRound
} from 'lucide-react';

// Lazily injects the Plaid Link script once and resolves with window.Plaid.
let _plaidScriptPromise = null;
const loadPlaidLink = () => {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (_plaidScriptPromise) return _plaidScriptPromise;
  _plaidScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.async = true;
    s.onload = () => resolve(window.Plaid);
    s.onerror = () => reject(new Error('Failed to load Plaid Link script'));
    document.body.appendChild(s);
  });
  return _plaidScriptPromise;
};

const API_URL = 'http://localhost:8000/api';

const extractCoreMerchant = (desc) => {
  if (!desc) return "UNKNOWN";
  const descUpper = desc.toString().toUpperCase();
  if (descUpper.includes("AMAZON PRIME") || descUpper.includes("AMZN PRIME") || descUpper.includes("AMZNPRIME")) return "AMAZON PRIME";
  if (descUpper.includes("GOOGLE FI") || descUpper.includes("GOOGLE *FI") || descUpper.includes("GOOGLE*FI")) return "GOOGLE FI";
  if (descUpper.includes("NETFLIX")) return "NETFLIX";
  if (descUpper.includes("SPOTIFY")) return "SPOTIFY";
  if (descUpper.includes("STARBUCKS")) return "STARBUCKS";
  if (descUpper.includes("WALMART") || descUpper.includes("WM SUPERCENTER") || descUpper.includes("WAL-MART")) return "WALMART";
  if (descUpper.includes("CHASE AUTOPAY") || descUpper.includes("CHASE AUTO-PMT")) return "CHASE AUTOPAY";
  if (descUpper.includes("DISCOVER") && (descUpper.includes("PYMT") || descUpper.includes("PAYMENT") || descUpper.includes("AUTOPAY"))) return "DISCOVER PYMT";
  if (descUpper.includes("CAPITAL ONE") && (descUpper.includes("AUTOPAY") || descUpper.includes("CRCARDPMT") || descUpper.includes("PYMT"))) return "CAPITAL ONE AUTOPAY";
  
  const clean = descUpper.replace(/null\s*[X\d]+|#\s*\d+|[*\d]+/gi, ' ')
                          .replace(/\b(IN|CA|MI|NY|TX|FL|MD|MT|OR|WA|NV|CLEARED|PENDING|TROY|IRVINE|TUSTIN)\b/gi, ' ')
                          .replace(/[^A-Z\s]/gi, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(" ");
};

const getCardTheme = (name, index) => {
  const n = name.toLowerCase();
  if (n.includes('sapphire')) return { from: '#0ea5e9', to: '#1e3a8a', labelColor: '#bae6fd', badge: 'Sapphire' };
  if (n.includes('citi')) return { from: '#06b6d4', to: '#0369a1', labelColor: '#cffafe', badge: 'Citi' };
  if (n.includes('discover')) return { from: '#f97316', to: '#c2410c', labelColor: '#ffedd5', badge: 'Discover' };
  if (n.includes('amex') || n.includes('american express')) return { from: '#eab308', to: '#854d0e', labelColor: '#fef9c3', badge: 'Amex' };
  if (n.includes('bofa') || n.includes('america') || n.includes('checking')) return { from: '#10b981', to: '#065f46', labelColor: '#d1fae5', badge: 'Checking' };
  if (n.includes('capital one')) return { from: '#6366f1', to: '#3730a3', labelColor: '#e0e7ff', badge: 'CapOne' };
  
  const defaultThemes = [
    { from: '#6366f1', to: '#312e81', labelColor: '#e0e7ff', badge: 'Card' },
    { from: '#ec4899', to: '#831843', labelColor: '#fce7f3', badge: 'Card' },
    { from: '#22c55e', to: '#14532d', labelColor: '#dcfce7', badge: 'Card' }
  ];
  return defaultThemes[index % defaultThemes.length];
};

const getMonthOffset = (baseYearMonth, offset) => {
  const [yearStr, monthStr] = baseYearMonth.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr) - 1;
  const d = new Date(year, month - offset, 15);
  return d.toISOString().slice(0, 7);
};

// "2026-06" -> "Jun 2026" for friendly display labels
const formatMonth = (ym) => {
  if (!ym || !`${ym}`.includes('-')) return ym;
  const [y, m] = `${ym}`.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = parseInt(m, 10) - 1;
  return names[idx] ? `${names[idx]} ${y}` : ym;
};

// Score band → cohesive color ramp (rose → amber → sky → emerald)
const scoreColor = (score) => {
  if (score >= 80) return { main: '#10b981', soft: '#34d399', text: 'text-emerald-500', bg: 'bg-emerald-500' };
  if (score >= 70) return { main: '#0ea5e9', soft: '#38bdf8', text: 'text-sky-500', bg: 'bg-sky-500' };
  if (score >= 60) return { main: '#f59e0b', soft: '#fbbf24', text: 'text-amber-500', bg: 'bg-amber-500' };
  return { main: '#f43f5e', soft: '#fb7185', text: 'text-rose-500', bg: 'bg-rose-500' };
};

const statusColor = (status) => (
  status === 'good' ? { main: '#10b981', bg: 'bg-emerald-500', text: 'text-emerald-500' }
  : status === 'warn' ? { main: '#f59e0b', bg: 'bg-amber-500', text: 'text-amber-500' }
  : { main: '#f43f5e', bg: 'bg-rose-500', text: 'text-rose-500' }
);

const toneClasses = (tone) => (
  tone === 'good' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/30'
  : tone === 'bad' ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/30'
  : 'text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 border-slate-200/60 dark:border-zinc-700'
);

// A delta chip: arrow + value, colored by tone (good/bad/neutral)
function DeltaChip({ value, tone, suffix = '%', prefix = '' }) {
  if (value === null || value === undefined) return <span className="text-[10px] text-slate-300 dark:text-zinc-600 font-bold">—</span>;
  const up = value > 0;
  const Arrow = value === 0 ? null : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-black py-0.5 px-1.5 rounded-md border ${toneClasses(tone)}`}>
      {Arrow && <Arrow size={10} strokeWidth={2.5} />}
      {prefix}{Math.abs(value)}{suffix}
    </span>
  );
}

// Lightweight inline SVG sparkline (no chart lib needed)
function Sparkline({ data, color = '#0ea5e9', width = 110, height = 30 }) {
  const gid = useId().replace(/:/g, '');
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (width - 4) + 2;
    const y = height - 3 - ((d.value - min) / range) * (height - 6);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="block overflow-visible">
      <defs>
        <linearGradient id={`spk${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spk${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

// Animated 270° radial gauge that counts up on mount / score change
function HealthGauge({ score = 0, grade = '—', label = '' }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const dur = 1000;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(score * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const size = 184, stroke = 12, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const sweep = 270;
  const arcLen = circ * (sweep / 360);
  const pct = Math.max(0, Math.min(100, shown)) / 100;
  const c = scoreColor(score);
  const gid = useId().replace(/:/g, '');

  return (
    <div className="relative flex-shrink-0 select-none animate-fade-in" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="block overflow-visible">
        <defs>
          <linearGradient id={`gaugeGrad-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c.soft} />
            <stop offset="100%" stopColor={c.main} />
          </linearGradient>
          <filter id={`gaugeGlow-${gid}`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Outer glowing track base */}
        <circle
          cx={cx} cy={cy} r={r + 3} fill="none"
          stroke="currentColor" className="text-slate-100/50 dark:text-zinc-900/30"
          strokeWidth={1.5} strokeDasharray={`${arcLen} ${circ}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* Main Track */}
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke="currentColor" className="text-slate-100 dark:text-zinc-800/80"
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circ}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* Glow behind the value arc */}
        {pct > 0 && (
          <circle
            cx={cx} cy={cy} r={r} fill="none"
            stroke={`url(#gaugeGrad-${gid})`}
            strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${arcLen * pct} ${circ}`}
            transform={`rotate(135 ${cx} ${cy})`}
            filter={`url(#gaugeGlow-${gid})`}
            opacity={0.4}
          />
        )}
        {/* Value arc */}
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={`url(#gaugeGrad-${gid})`}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${arcLen * pct} ${circ}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* Thin overlay sheen line */}
        {pct > 0 && (
          <circle
            cx={cx} cy={cy} r={r - 3.5} fill="none"
            stroke="#ffffff" opacity={0.25}
            strokeWidth={1.2} strokeLinecap="round"
            strokeDasharray={`${(arcLen * pct) - 8} ${circ}`}
            transform={`rotate(137 ${cx} ${cy})`}
          />
        )}
      </svg>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-[52px] font-black tracking-tighter tnum leading-none drop-shadow-sm ${c.text}`}>{Math.round(shown)}</span>
        <span className="text-[10px] font-extrabold text-slate-400 dark:text-zinc-500 uppercase tracking-widest mt-1.5">out of 100</span>
        <div className="mt-2.5 flex items-center gap-1.5 bg-white/80 dark:bg-zinc-900/80 border border-slate-200/50 dark:border-zinc-800/80 px-2.5 py-0.5 rounded-full shadow-sm">
          <span className="text-[11px] font-black tracking-tight text-slate-700 dark:text-zinc-200">{grade}</span>
          <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">·</span>
          <span className={`text-[10px] font-black uppercase tracking-wider ${c.text}`}>{label}</span>
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const formattedLabel = label && label.toString().includes('-') ? (() => {
      const [y, m] = label.toString().split('-');
      const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const idx = parseInt(m, 10) - 1;
      return names[idx] ? `${names[idx]} ${y}` : label;
    })() : label;
    return (
      <div className="bg-white/85 dark:bg-zinc-900/80 border border-slate-200/50 dark:border-zinc-800/80 p-3 rounded-xl shadow-xl backdrop-blur-md select-none animate-fade-in flex flex-col gap-1.5 min-w-[140px]">
        <p className="text-[10px] font-black text-slate-400 dark:text-zinc-550 uppercase tracking-widest">{formattedLabel}</p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry) => (
            <div key={entry.name} className="flex justify-between items-center gap-4 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-slate-500 dark:text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                {entry.name.charAt(0).toUpperCase() + entry.name.slice(1)}
              </span>
              <span className="font-extrabold text-slate-900 dark:text-zinc-100 tnum">
                ${Number(entry.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

// Tracks the OS "reduce motion" preference for JS-driven animations.
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Eased count-up toward `value`; jumps instantly when reduced-motion is on.
function useCountUp(value, duration = 850) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (reduced || value === fromRef.current) { setShown(value); fromRef.current = value; return; }
    const from = fromRef.current;
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (value - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    // Guarantee the final value lands even if rAF is throttled (e.g. a background tab).
    const settle = setTimeout(() => { setShown(value); fromRef.current = value; }, duration + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, [value, duration, reduced]);
  return shown;
}

// Renders a number that animates to its target value, formatted via `format`.
function AnimatedNumber({ value = 0, format = (v) => v.toLocaleString(), className }) {
  const shown = useCountUp(value);
  return <span className={className}>{format(shown)}</span>;
}

// Shimmer placeholder used while data loads.
function Skeleton({ className = '' }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden="true" />;
}

export default function App() {
    const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const [chartType, setChartType] = useState('Line'); // 'Line' or 'Bar'

  // --- TOAST NOTIFICATIONS (replaces blocking alert() popups) ---
  const [toasts, setToasts] = useState([]);
  const notify = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };
  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  const TAB_IDS = ['Executive Dashboard', 'AI Ledger', 'Data Pipeline', 'Settings'];
  const [activeTab, setActiveTab] = useState(() => {
    const stored = localStorage.getItem('activeTab');
    return stored && TAB_IDS.includes(stored) ? stored : 'Executive Dashboard';
  });
  useEffect(() => { localStorage.setItem('activeTab', activeTab); }, [activeTab]);
  const [userProfile, setUserProfile] = useState("All Users");

  // Power-user keyboard navigation: press 1-4 to jump between top-level tabs
  // (ignored while typing in a field). See the kbd hints in the nav.
  useEffect(() => {
    const tabOrder = ['Executive Dashboard', 'AI Ledger', 'Data Pipeline', 'Settings'];
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (/(INPUT|SELECT|TEXTAREA)/.test(t.tagName) || t.isContentEditable)) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < tabOrder.length) {
        setActiveTab(tabOrder[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  
  // Start and End Month Ranges
  const [startMonth, setStartMonth] = useState("All Time");
  const [endMonth, setEndMonth] = useState("All Time");

  // --- DYNAMIC TAXONOMY & CATEGORIES ---
  const [categories, setCategories] = useState({
    Income: ['Salary', 'Zelle Transfers', 'Wages', 'Income', 'Rewards', 'Refunds'],
    Expense: ['Dining', 'Groceries', 'Gas', 'Merchandise', 'Travel', 'Housing', 'Bills', 'Personal Growth Expenses', 'Debt', 'Uncategorized'],
    Savings: ['Emergency Fund', 'Brokerage', 'Crypto', 'Investments'],
    Transfer: ['Transfer', 'Credit Card Payment']
  });

  const [settings, setSettings] = useState({ declared_banks: [], budgets: {} });
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const [newBankForm, setNewBankForm] = useState({ name: "", type: "Banking", owner: "big_boo" });

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_URL}/categories`);
      const data = await response.json();
      if (data && data.Income) {
        setCategories(data);
      }
    } catch (err) {
      console.error("Failed to fetch categories", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${API_URL}/settings`);
      const data = await response.json();
      if (data) {
        setSettings(data);
      }
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const handleSaveSettings = async (updatedSettings) => {
    try {
      const response = await fetch(`${API_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings)
      });
      const result = await response.json();
      if (result.status === "success") {
        setSettings(updatedSettings);
        refreshAnalytics();
      } else {
        notify("Failed to save settings: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Error saving settings", err);
    }
  };

  // --- Monthly budget modal (manage caps directly from the dashboard) ---------------
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetEdits, setBudgetEdits] = useState({});
  const [newBudget, setNewBudget] = useState({ category: '', amount: '' });

  const openBudgetModal = () => {
    setBudgetEdits({ ...(settings.budgets || {}) });
    setNewBudget({ category: '', amount: '' });
    setShowBudgetModal(true);
  };

  const addBudgetRow = () => {
    const cat = newBudget.category;
    const amt = parseFloat(newBudget.amount);
    if (!cat || isNaN(amt) || amt <= 0) return;
    setBudgetEdits(prev => ({ ...prev, [cat]: amt }));
    setNewBudget({ category: '', amount: '' });
  };

  const removeBudgetRow = (cat) => {
    setBudgetEdits(prev => { const next = { ...prev }; delete next[cat]; return next; });
  };

  const saveBudgetModal = () => {
    const cleaned = {};
    Object.entries(budgetEdits).forEach(([k, v]) => {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) cleaned[k] = n;
    });
    // Also capture a row the user typed into the "add" fields but didn't explicitly
    // commit with the + button — saving should never silently drop their input.
    const pendingAmt = parseFloat(newBudget.amount);
    if (newBudget.category && !isNaN(pendingAmt) && pendingAmt > 0) {
      cleaned[newBudget.category] = pendingAmt;
    }
    handleSaveSettings({ ...settings, budgets: cleaned });
    setShowBudgetModal(false);
  };

  const handleUploadSlotFiles = async (files, bank) => {
    if (!files || files.length === 0) return;
    
    setUploadingSlot(bank.name);
    try {
      const formData = new FormData();
      Array.from(files).forEach(file => formData.append('files', file));
      formData.append('bucket', bank.type === 'Banking' ? 'Banking Bucket' : 'Credit Card Bucket');
      formData.append('user_profile', bank.owner);
      formData.append('account_name', bank.name);
      
      const response = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      
      if (result.status === "error") {
        throw new Error(result.message);
      }
      
      notify(`Statement ingested into the "${bank.name}" slot.`, 'success');
      refreshAnalytics();
      setActiveTab('Executive Dashboard');
    } catch (error) {
      console.error("Upload error for slot:", error);
      notify(`Upload failed for "${bank.name}": ${error.message}`, 'error');
    } finally {
      setUploadingSlot(null);
    }
  };

  // --- PLAID BANK CONNECTIONS ---
  const [plaidConfigured, setPlaidConfigured] = useState(true);
  const [plaidStatus, setPlaidStatus] = useState({ environment: 'production', client_id_masked: '', has_secret: false, redirect_uri: '' });
  const [plaidItems, setPlaidItems] = useState([]);
  const [plaidConnecting, setPlaidConnecting] = useState(null); // person currently linking
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  // In-app Plaid credential entry (replaces hand-editing .env).
  const [showPlaidConfig, setShowPlaidConfig] = useState(false);
  const [plaidSavingConfig, setPlaidSavingConfig] = useState(false);
  const [plaidForm, setPlaidForm] = useState({ client_id: '', secret: '', env: 'production', redirect_uri: '' });

  const fetchPlaidStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/plaid/status`);
      const data = await res.json();
      setPlaidConfigured(!!data.configured);
      setPlaidStatus({
        environment: data.environment || 'production',
        client_id_masked: data.client_id_masked || '',
        has_secret: !!data.has_secret,
        redirect_uri: data.redirect_uri || '',
      });
      // Prefill the form's non-secret fields so editing keeps existing values.
      setPlaidForm((f) => ({
        ...f,
        env: data.environment || 'production',
        redirect_uri: data.redirect_uri || '',
      }));
    } catch {
      setPlaidConfigured(false);
    }
  };

  const handleSavePlaidConfig = async () => {
    if (!plaidForm.client_id.trim()) {
      notify('Enter your Plaid Client ID.', 'error');
      return;
    }
    // Secret is required the first time, but optional when only changing env/redirect.
    if (!plaidForm.secret.trim() && !plaidStatus.has_secret) {
      notify('Enter your Plaid Secret.', 'error');
      return;
    }
    setPlaidSavingConfig(true);
    try {
      const res = await fetch(`${API_URL}/plaid/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plaidForm),
      });
      const data = await res.json();
      if (data.status === 'error') throw new Error(data.message);
      notify('Plaid credentials saved — you can connect a bank now.', 'success');
      setShowPlaidConfig(false);
      setPlaidForm((f) => ({ ...f, secret: '' })); // don't keep the secret in memory
      await fetchPlaidStatus();
      await fetchPlaidItems();
    } catch (err) {
      notify(`Could not save Plaid keys: ${err.message}`, 'error');
    } finally {
      setPlaidSavingConfig(false);
    }
  };

  const fetchPlaidItems = async () => {
    try {
      const res = await fetch(`${API_URL}/plaid/items`);
      const data = await res.json();
      if (data.status === 'success') setPlaidItems(data.items || []);
    } catch (err) {
      console.error('Failed to fetch Plaid items', err);
    }
  };

  const handlePlaidSync = async (person = null) => {
    setPlaidSyncing(true);
    try {
      const res = await fetch(`${API_URL}/plaid/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person }),
      });
      const result = await res.json();
      if (result.status === 'error') throw new Error(result.message);
      if (result.added > 0) {
        notify(`Synced ${result.added} new transaction(s) from your banks.`, 'success');
        refreshAnalytics();
      } else {
        notify('Banks are up to date — no new transactions.', 'info');
      }
    } catch (err) {
      notify(`Sync failed: ${err.message}`, 'error');
    } finally {
      setPlaidSyncing(false);
    }
  };

  // Auto-sync Plaid on every app load / page refresh so the ledger is always
  // current without the user clicking "Sync All Banks". Self-contained (does its
  // own status/items fetch to avoid state-timing races) and stays silent unless
  // it actually pulls something in — no toast on every refresh when up to date.
  const autoSyncPlaid = async () => {
    try {
      const statusRes = await fetch(`${API_URL}/plaid/status`);
      const status = await statusRes.json();
      if (!status.configured) return;
      const itemsRes = await fetch(`${API_URL}/plaid/items`);
      const itemsData = await itemsRes.json();
      if (!(itemsData.status === 'success' && (itemsData.items || []).length > 0)) return;

      setPlaidSyncing(true);
      const res = await fetch(`${API_URL}/plaid/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person: null }),
      });
      const result = await res.json();
      if (result.status === 'error') throw new Error(result.message);
      if (result.added > 0) {
        notify(`Auto-synced ${result.added} new transaction(s) from your banks.`, 'success');
        refreshAnalytics();
      }
    } catch (err) {
      // Quiet failure — don't nag on every page load; the manual Sync button
      // surfaces real errors when the user explicitly asks for a sync.
      console.warn('Plaid auto-sync skipped:', err?.message || err);
    } finally {
      setPlaidSyncing(false);
    }
  };

  const handleConnectBank = async (person) => {
    setPlaidConnecting(person);
    try {
      const res = await fetch(`${API_URL}/plaid/create_link_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person }),
      });
      const data = await res.json();
      if (data.status === 'error' || !data.link_token) {
        throw new Error(data.message || 'Could not start Plaid Link.');
      }

      const Plaid = await loadPlaidLink();
      const handler = Plaid.create({
        token: data.link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            const exRes = await fetch(`${API_URL}/plaid/exchange_public_token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                public_token,
                person,
                institution_name: metadata?.institution?.name || 'Bank',
              }),
            });
            const exData = await exRes.json();
            if (exData.status === 'error') throw new Error(exData.message);
            notify(`Connected ${exData.institution_name}. Pulling transactions…`, 'success');
            await fetchPlaidItems();
            await handlePlaidSync(person);
          } catch (err) {
            notify(`Could not finish connecting: ${err.message}`, 'error');
          } finally {
            setPlaidConnecting(null);
          }
        },
        onExit: (err) => {
          setPlaidConnecting(null);
          if (err) notify(`Plaid Link closed: ${err.display_message || err.error_message || 'cancelled'}`, 'info');
        },
      });
      handler.open();
    } catch (err) {
      notify(`Could not connect bank: ${err.message}`, 'error');
      setPlaidConnecting(null);
    }
  };

  const handleRemoveBank = async (item) => {
    if (!window.confirm(`Disconnect ${item.institution_name}? Past transactions stay in your ledger; future syncs stop.`)) return;
    try {
      const res = await fetch(`${API_URL}/plaid/items/${encodeURIComponent(item.item_id)}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.status === 'error') throw new Error(result.message);
      notify(`Disconnected ${item.institution_name}.`, 'success');
      fetchPlaidItems();
    } catch (err) {
      notify(`Could not disconnect: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchSettings();
    fetchPlaidStatus();
    fetchPlaidItems();
  }, []);

  // Pull fresh Plaid transactions automatically on each load/refresh.
  useEffect(() => {
    autoSyncPlaid();
  }, []);

  // Taxonomy save action
  const handleSaveCategories = async (updatedCats) => {
    try {
      const response = await fetch(`${API_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: updatedCats })
      });
      const result = await response.json();
      if (result.status === "success") {
        setCategories(updatedCats);
      } else {
        notify("Failed to save taxonomy: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Error saving taxonomy", err);
    }
  };

  // Action to add a new dynamic category
  const addCategory = (type, name) => {
    if (!name) return;
    const cleanName = name.trim();
    if (categories[type].includes(cleanName)) return;
    const updated = { ...categories, [type]: [...categories[type], cleanName] };
    handleSaveCategories(updated);
  };

  // Action to delete a category
  const deleteCategory = (type, name) => {
    const updated = { ...categories, [type]: categories[type].filter(c => c !== name) };
    handleSaveCategories(updated);
  };

  // --- AI LEDGER STATE ---
  const [ledgerData, setLedgerData] = useState([]);
  const [isConfirmingAll, setIsConfirmingAll] = useState(false);

  const fetchLedgerData = async () => {
    try {
      const response = await fetch(`${API_URL}/ledger?person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      if (Array.isArray(data)) setLedgerData(data);
    } catch (err) {
      console.error("Failed to fetch ledger", err);
    }
  };

  useEffect(() => {
    if (activeTab === 'AI Ledger') {
      fetchLedgerData();
      fetchConflicts();
    }
  }, [activeTab, userProfile]);

  const handleDismissWizardRow = async (id, dismissedCategory) => {
    setDismissingRow(id);
    try {
      const response = await fetch(`${API_URL}/ledger/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: id, dismissed_category: dismissedCategory })
      });
      const result = await response.json();
      if (result.status === "success") {
        await fetchLedgerData();
        refreshAnalytics();
      } else {
        notify("Failed to dismiss suggestion: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Dismiss wizard row error", err);
      notify("Error dismissing category suggestion.", 'error');
    } finally {
      setDismissingRow(null);
    }
  };

  // --- SUB-TABS & EXTRA STATES ---
  const [ledgerSubTab, setLedgerSubTab] = useState('Wizard'); // 'Verify', 'Conflicts', 'Audit', or 'Wizard'
  const [wizardIndex, setWizardIndex] = useState(0);
  const [wizardExclusions, setWizardExclusions] = useState({});
  const [wizardOverrides, setWizardOverrides] = useState({});
  const [masterCategoryVal, setMasterCategoryVal] = useState("");
  const [dismissingRow, setDismissingRow] = useState(null);
  const [conflictData, setConflictData] = useState([]);
  const [isScanningFolder, setIsScanningFolder] = useState(false);
  // Duplicate review (Data Pipeline tab)
  const [dupGroups, setDupGroups] = useState([]);
  const [dupSummary, setDupSummary] = useState(null);
  const [dupSelected, setDupSelected] = useState({}); // { transactionId: true } => marked for removal
  const [isScanningDups, setIsScanningDups] = useState(false);
  const [isRemovingDups, setIsRemovingDups] = useState(false);
  const [dupScanned, setDupScanned] = useState(false);
  const [pieChartTab, setPieChartTab] = useState('Expense'); // 'Expense' or 'Income'
  const [subFilter, setSubFilter] = useState('All');
  const [subSearch, setSubSearch] = useState('');
  const [showInactiveSubs, setShowInactiveSubs] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [expandedSub, setExpandedSub] = useState(null);
  // Recategorize popup for a single recurring-cashflow charge
  const [chargeMenu, setChargeMenu] = useState(null); // { id, merchant, date, amount, category, scope }
  const [isSavingCharge, setIsSavingCharge] = useState(false);

  // Reset interactive selections when filters or tabs change
  useEffect(() => {
    setSelectedCategory(null);
    setExpandedSub(null);
  }, [userProfile, startMonth, endMonth, pieChartTab, activeTab]);

  // Reset master category selector on category group changes
  useEffect(() => {
    setMasterCategoryVal("");
  }, [wizardIndex, ledgerData]);

  // Clear the duplicate-review results when the active profile changes (stale otherwise)
  useEffect(() => {
    setDupGroups([]);
    setDupSummary(null);
    setDupSelected({});
    setDupScanned(false);
  }, [userProfile]);

  // Reset wizard index when profile changes
  useEffect(() => {
    setWizardIndex(0);
    setWizardOverrides({});
    setWizardExclusions({});
  }, [userProfile]);
  
  // Categorized History Audit Tab State
  const [categorizedData, setCategorizedData] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingCategorized, setIsLoadingCategorized] = useState(false);

  const fetchCategorizedData = async () => {
    setIsLoadingCategorized(true);
    try {
      const response = await fetch(`${API_URL}/ledger/categorized?search=${encodeURIComponent(searchQuery)}&person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      if (Array.isArray(data)) setCategorizedData(data);
    } catch (err) {
      console.error("Failed to fetch categorized ledger", err);
    } finally {
      setIsLoadingCategorized(false);
    }
  };

  const handleRecategorize = async (id, category) => {
    try {
      const response = await fetch(`${API_URL}/ledger/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: id, category: category })
      });
      const result = await response.json();
      if (result.status === "success") {
        setCategorizedData(prev => prev.map(item => item.id === id ? { ...item, category: category } : item));
        refreshAnalytics();
        fetchLedgerData();
      } else {
        notify("Failed to update category: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Failed to recategorize row", err);
      notify("The backend rejected the save. Please try again.", 'error');
    }
  };

  // Recategorize a recurring-cashflow charge with a chosen blast radius. The scope
  // ("one" | "year" | "all") is handled server-side by /ledger/recategorize_scope:
  // "one" touches just this charge, "year" sweeps every charge from this merchant in
  // the same calendar year, and "all" sweeps all-time and saves a merchant rule.
  const handleChargeRecategorize = async () => {
    if (!chargeMenu?.id) return;
    if (!chargeMenu.category) { notify('Pick a category first.', 'info'); return; }
    setIsSavingCharge(true);
    try {
      const response = await fetch(`${API_URL}/ledger/recategorize_scope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: chargeMenu.id, category: chargeMenu.category, scope: chargeMenu.scope || 'one' })
      });
      const result = await response.json();
      if (result.status === 'success') {
        notify(result.message || `Recategorized to ${chargeMenu.category}.`, 'success');
        setChargeMenu(null);
        fetchSubscriptions();
        refreshAnalytics();
      } else {
        notify(result.message || 'Update failed.', 'error');
      }
    } catch (err) {
      console.error('Failed to recategorize charge', err);
      notify('Error updating category.', 'error');
    } finally {
      setIsSavingCharge(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'AI Ledger' && ledgerSubTab === 'Audit') {
      fetchCategorizedData();
    }
  }, [activeTab, ledgerSubTab, searchQuery, userProfile]);

  const fetchConflicts = async () => {
    try {
      const response = await fetch(`${API_URL}/ledger/conflicts?person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      if (Array.isArray(data)) setConflictData(data);
    } catch (err) {
      console.error("Failed to fetch conflicts", err);
    }
  };

  const handleResolveConflict = async (merchant, targetCategory) => {
    try {
      const response = await fetch(`${API_URL}/ledger/conflicts/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant, target_category: targetCategory })
      });
      const result = await response.json();
      if (result.status === "success") {
        notify(result.message, 'success');
        fetchConflicts();
        fetchLedgerData();
        refreshAnalytics();
      } else {
        notify("Failed to resolve conflict: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Conflict resolution error", err);
      notify("Error resolving conflict.", 'error');
    }
  };

  const handleAllowMultiCategory = async (merchant) => {
    try {
      const response = await fetch(`${API_URL}/ledger/conflicts/whitelist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant })
      });
      const result = await response.json();
      if (result.status === "success") {
        notify(result.message, 'success');
        fetchConflicts();
      } else {
        notify("Failed to ignore conflict: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Conflict whitelist error", err);
      notify("Error whitelisting merchant.", 'error');
    }
  };

  const fetchDuplicates = async () => {
    setIsScanningDups(true);
    try {
      const response = await fetch(`${API_URL}/maintenance/duplicates?person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      const groups = Array.isArray(data.groups) ? data.groups : [];
      setDupGroups(groups);
      setDupSummary(data.summary || null);
      // Pre-select every suggested removal so a confident user can wipe them in one click.
      const preselect = {};
      groups.forEach(g => (g.suggested_remove || []).forEach(id => { preselect[id] = true; }));
      setDupSelected(preselect);
      setDupScanned(true);
    } catch (err) {
      console.error("Failed to scan duplicates", err);
      notify("Error scanning for duplicates.", 'error');
    } finally {
      setIsScanningDups(false);
    }
  };

  const toggleDupSelection = (id) => {
    setDupSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedDupCount = Object.values(dupSelected).filter(Boolean).length;

  const handleRemoveDuplicates = async () => {
    const ids = Object.keys(dupSelected).filter(id => dupSelected[id]);
    if (ids.length === 0) {
      notify("No duplicates selected to remove.", 'info');
      return;
    }
    setIsRemovingDups(true);
    try {
      const response = await fetch(`${API_URL}/maintenance/duplicates/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: ids })
      });
      const result = await response.json();
      if (result.status === "success") {
        notify(result.message, 'success');
        fetchDuplicates();
        refreshAnalytics();
      } else {
        notify(result.message || "Removal failed.", result.status === 'info' ? 'info' : 'error');
      }
    } catch (err) {
      console.error("Duplicate removal error", err);
      notify("Error removing duplicates.", 'error');
    } finally {
      setIsRemovingDups(false);
    }
  };

  const handleWizardConfirm = async (activeCat, activeTxs) => {
    if (!activeCat || activeTxs.length === 0) return;
    
    const updates = [];
    activeTxs.forEach(row => {
      if (wizardExclusions[row.id]) {
        // If excluded, check if they set a custom override category
        const overrideCat = wizardOverrides[row.id];
        if (overrideCat && overrideCat !== 'Uncategorized') {
          updates.push({ transaction_id: row.id, category: overrideCat });
        }
      } else {
        // Standard confirm under activeCat (or override if modified)
        const finalCat = wizardOverrides[row.id] || activeCat;
        if (finalCat !== 'Uncategorized') {
          updates.push({ transaction_id: row.id, category: finalCat });
        }
      }
    });
    
    if (updates.length === 0) {
      // If they excluded everything and didn't set overrides, just clear and return
      setWizardExclusions({});
      setWizardOverrides({});
      return;
    }
    
    setIsConfirmingAll(true);
    try {
      const response = await fetch(`${API_URL}/ledger/confirm_all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      const result = await response.json();
      if (result.status === "success") {
        await fetchLedgerData();
        refreshAnalytics();
        setWizardExclusions({});
        setWizardOverrides({});
      } else {
        notify("Failed to confirm: " + result.message, 'error');
      }
    } catch (err) {
      console.error("Wizard confirm error", err);
      notify("Error confirming batch.", 'error');
    } finally {
      setIsConfirmingAll(false);
    }
  };

  const handleScanFolders = async () => {
    setIsScanningFolder(true);
    try {
      const response = await fetch(`${API_URL}/pipeline/run`, {
        method: 'POST'
      });
      const result = await response.json();
      if (result.status === "success" || result.status === "info") {
        notify(result.message, 'success');
        refreshAnalytics();
        fetchLedgerData();
        fetchConflicts();
        setActiveTab('AI Ledger');
      } else {
        notify(result.message || "Failed to scan folders.", 'error');
      }
    } catch (err) {
      console.error("Folder scan error", err);
      notify("Error scanning folder statement drops.", 'error');
    } finally {
      setIsScanningFolder(false);
    }
  };

  // --- DASHBOARD STATE ---
  const [dashboardData, setDashboardData] = useState({
    kpis: { income: 0, expenses: 0, savings: 0, savingsRate: 0 },
    incomeData: [],
    expenseData: [],
    savingsData: [],
    topMerchants: [],
    topSources: [],
    cardBreakdown: [],
    trendData: [],
    uniqueMonths: [],
    uniqueProfiles: []
  });
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);

  // --- FINANCIAL HEALTH SCORE STATE ---
  const [healthScore, setHealthScore] = useState(null);
  const [expandedPillar, setExpandedPillar] = useState(null);
  const fetchHealthScore = async () => {
    try {
      const response = await fetch(
        `${API_URL}/health_score?start_month=${encodeURIComponent(startMonth)}&end_month=${encodeURIComponent(endMonth)}&person=${encodeURIComponent(userProfile)}`
      );
      const data = await response.json();
      if (data && typeof data.score !== 'undefined') setHealthScore(data);
    } catch (err) {
      console.error("Failed to fetch health score", err);
    }
  };

  // --- WEALTH INSIGHTS STATE (contributions + opportunity cost) ---
  const [wealthInsights, setWealthInsights] = useState(null);
  const fetchWealthInsights = async () => {
    try {
      const response = await fetch(`${API_URL}/wealth_insights?person=${encodeURIComponent(userProfile)}&start_month=${encodeURIComponent(startMonth)}&end_month=${encodeURIComponent(endMonth)}`);
      const data = await response.json();
      if (data) setWealthInsights(data);
    } catch (err) {
      console.error("Failed to fetch wealth insights", err);
    }
  };

  // --- SMART RULES STATE ---
  const [smartRules, setSmartRules] = useState([]);
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleSearchResults, setRuleSearchResults] = useState({ matches: [], summary: { total: 0, positive: 0, negative: 0, categories: [] } });
  const [isSearchingRules, setIsSearchingRules] = useState(false);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const blankRule = { keyword: "", category: "", amount_op: "any", amount_value: "", date_start: "", date_end: "" };
  const [newRule, setNewRule] = useState(blankRule);

  const fetchSmartRules = async () => {
    try {
      const response = await fetch(`${API_URL}/rules`);
      const data = await response.json();
      if (Array.isArray(data)) setSmartRules(data);
    } catch (err) {
      console.error("Failed to fetch smart rules", err);
    }
  };

  const searchTransactionsForRules = async (q) => {
    if (!q || !q.trim()) {
      setRuleSearchResults({ matches: [], summary: { total: 0, positive: 0, negative: 0, categories: [] } });
      return;
    }
    setIsSearchingRules(true);
    try {
      const response = await fetch(`${API_URL}/transactions/search?q=${encodeURIComponent(q)}&person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      if (data && data.summary) setRuleSearchResults(data);
    } catch (err) {
      console.error("Transaction search failed", err);
    } finally {
      setIsSearchingRules(false);
    }
  };

  const handleCreateRule = async () => {
    if (!newRule.keyword.trim()) { notify("Enter a keyword to match.", 'error'); return; }
    if (!newRule.category) { notify("Pick a category to assign.", 'error'); return; }
    setIsSavingRule(true);
    try {
      const payload = {
        keyword: newRule.keyword.trim(),
        category: newRule.category,
        amount_op: newRule.amount_op,
        amount_value: (newRule.amount_op === 'gte' || newRule.amount_op === 'lte') ? parseFloat(newRule.amount_value || 0) : 0,
        date_start: newRule.date_start || null,
        date_end: newRule.date_end || null,
        person: userProfile
      };
      const response = await fetch(`${API_URL}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.status === "success") {
        notify(result.message, 'success');
        setNewRule(prev => ({ ...blankRule, keyword: prev.keyword }));
        fetchSmartRules();
        refreshAnalytics();
        searchTransactionsForRules(ruleSearch);
      } else {
        notify(result.message || "Failed to save rule.", 'error');
      }
    } catch (err) {
      console.error("Create rule error", err);
      notify("Error saving rule.", 'error');
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDeleteRule = async (id) => {
    try {
      const response = await fetch(`${API_URL}/rules/${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (result.status === "success") {
        notify("Rule deleted.", 'success');
        fetchSmartRules();
      }
    } catch (err) {
      console.error("Delete rule error", err);
    }
  };

  const handleApplyAllRules = async () => {
    try {
      const response = await fetch(`${API_URL}/rules/apply`, { method: 'POST' });
      const result = await response.json();
      notify(result.message, 'success');
      fetchSmartRules();
      refreshAnalytics();
    } catch (err) {
      console.error("Apply rules error", err);
      notify("Error applying rules.", 'error');
    }
  };

  // Load rules when entering the Smart Rules sub-tab; debounce keyword search
  const onRulesSubTab = activeTab === 'AI Ledger' && ledgerSubTab === 'Rules';
  useEffect(() => {
    if (onRulesSubTab) fetchSmartRules();
  }, [onRulesSubTab]);

  useEffect(() => {
    if (!onRulesSubTab) return;
    const t = setTimeout(() => searchTransactionsForRules(ruleSearch), 350);
    return () => clearTimeout(t);
  }, [ruleSearch, userProfile, onRulesSubTab]);

  // Scan for duplicates when entering AI Ledger so the Duplicates sub-tab badge is populated
  // (cheap + cached server-side)
  useEffect(() => {
    if (activeTab === 'AI Ledger') fetchDuplicates();
  }, [activeTab, userProfile]);

  // --- TREND ANALYTICS STATE ---
  const [trends, setTrends] = useState(null);
  const fetchTrends = async () => {
    try {
      const response = await fetch(`${API_URL}/trends?person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      if (data && typeof data.available !== 'undefined') setTrends(data);
    } catch (err) {
      console.error("Failed to fetch trends", err);
    }
  };

  const fetchDashboardData = async () => {
    setIsLoadingDashboard(true);
    try {
      const response = await fetch(
        `${API_URL}/dashboard?start_month=${encodeURIComponent(startMonth)}&end_month=${encodeURIComponent(endMonth)}&person=${encodeURIComponent(userProfile)}`
      );
      const data = await response.json();
      if (data && data.kpis) {
        setDashboardData(data);
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  // Refresh every derived view after the underlying data changes, so counters
  // like the Roth IRA contribution and the health score update immediately —
  // without needing a manual page reload.
  const refreshAnalytics = () => {
    fetchDashboardData();
    fetchHealthScore();
    fetchWealthInsights();
  };

  useEffect(() => {
    fetchDashboardData();
    fetchHealthScore();
    fetchWealthInsights();
  }, [startMonth, endMonth, userProfile]);

  // Heartbeat: tells the backend a browser tab is open. When every tab is closed
  // the pings stop and the backend shuts itself down (see start.py / api.py), so
  // Wally doesn't keep running after you close the window.
  useEffect(() => {
    const beat = () => { fetch(`${API_URL}/heartbeat`).catch(() => {}); };
    beat();
    const id = setInterval(beat, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchTrends();
  }, [userProfile]);

  const currentMonthStr = new Date().toISOString().slice(0, 7); // e.g. "2026-06"

  // Date Presets Handler
  const applyPreset = (preset) => {
    if (preset === 'All Time') {
      setStartMonth("All Time");
      setEndMonth("All Time");
    } else if (preset === 'Last Month') {
      // Previous complete calendar month (the current month is still partial).
      const lastMonth = getMonthOffset(currentMonthStr, 1);
      setStartMonth(lastMonth);
      setEndMonth(lastMonth);
    } else if (preset === 'Last 3 Months') {
      setStartMonth(getMonthOffset(currentMonthStr, 2));
      setEndMonth(currentMonthStr);
    } else if (preset === 'Last 6 Months') {
      setStartMonth(getMonthOffset(currentMonthStr, 5));
      setEndMonth(currentMonthStr);
    } else if (preset === 'YTD') {
      setStartMonth(`${currentMonthStr.split('-')[0]}-01`);
      setEndMonth(currentMonthStr);
    }
  };

  useEffect(() => {
    if (activeTab === 'Executive Dashboard') {
      fetchSubscriptions();
      fetchTrends();
    }
  }, [activeTab, ledgerData, userProfile]);

  // --- SUBSCRIPTIONS STATE ---
  const [subscriptions, setSubscriptions] = useState([]);
  const fetchSubscriptions = async () => {
    try {
      const response = await fetch(`${API_URL}/subscriptions?person=${encodeURIComponent(userProfile)}`);
      const data = await response.json();
      if (Array.isArray(data)) setSubscriptions(data);
    } catch (err) {
      console.error("Failed to fetch subscriptions", err);
    }
  };

  const [newCatName, setNewCatName] = useState({ Income: "", Expense: "", Savings: "" });
  const COLORS = ['#0ea5e9', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f43f5e', '#14b8a6'];

  const unverifiedTransactions = (ledgerData || []).filter(row => !row.verified);
  const groupedCategories = {};
  unverifiedTransactions.forEach(row => {
    const cat = row.category || 'Uncategorized';
    if (!groupedCategories[cat]) groupedCategories[cat] = [];
    groupedCategories[cat].push(row);
  });
  const wizardCategories = Object.keys(groupedCategories).filter(c => c !== 'Uncategorized');
  if (groupedCategories['Uncategorized'] && groupedCategories['Uncategorized'].length > 0) {
    wizardCategories.push('Uncategorized');
  }

  return (
    <div className="min-h-screen app-bg text-slate-850 dark:text-zinc-100 font-sans pb-16" style={{ scrollBehavior: 'smooth' }}>
      {/* UNIFIED HEADER BAR */}
      <header className="flex justify-between items-center gap-4 px-5 sm:px-6 py-3 bg-white/70 dark:bg-zinc-950/60 border border-slate-200/40 dark:border-zinc-800/50 rounded-2xl mx-4 my-3 sticky top-3 z-30 backdrop-blur-xl shadow-md shadow-slate-100/40 dark:shadow-none">
        {/* Brand Logo */}
        <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => setActiveTab('Executive Dashboard')}>
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-sky-500 to-sky-600 rounded-xl blur opacity-25 group-hover:opacity-75 transition duration-500"></div>
            <div className="relative w-9 h-9 bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl flex items-center justify-center text-white font-black text-base shadow-lg ring-1 ring-white/10">
              W
            </div>
          </div>
          <div className="leading-tight hidden sm:block">
            <span className="block bg-gradient-to-r from-sky-500 to-sky-500 bg-clip-text text-transparent font-black tracking-tight text-[15px]">Wally</span>
            <span className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-[0.18em]">Your money, at a glance</span>
          </div>
        </div>

        {/* Navigation Tabs (Center) */}
        <nav className="flex gap-0.5 bg-slate-100/50 dark:bg-zinc-900/50 p-1 rounded-xl border border-slate-200/40 dark:border-zinc-800/50">
          {[
            { id: 'Executive Dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'AI Ledger', label: 'AI Ledger', icon: Sparkles },
            { id: 'Data Pipeline', label: 'Pipeline', icon: UploadCloud },
            { id: 'Settings', label: 'Settings', icon: SettingsIcon },
          ].map(({ id, label, icon: Icon }, i) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                title={`${label}  ·  press ${i + 1}`}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 text-xs font-bold py-2 px-3 lg:px-4 rounded-lg transition-all cursor-pointer select-none ${
                  active
                    ? 'bg-white dark:bg-zinc-800 text-sky-600 dark:text-sky-400 shadow-sm border border-slate-200/50 dark:border-zinc-700/60'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-zinc-800/30'
                }`}
              >
                <Icon size={14} strokeWidth={active ? 2.5 : 1.8} />
                <span className="hidden lg:inline">{label}</span>
                <kbd className={`hidden lg:inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold leading-none border transition-colors ${
                  active
                    ? 'border-sky-300/60 text-sky-500/80 dark:border-sky-700/60 dark:text-sky-400/70'
                    : 'border-slate-200/70 text-slate-400/70 dark:border-zinc-700/70 dark:text-zinc-500'
                }`}>{i + 1}</kbd>
              </button>
            );
          })}
        </nav>

        {/* Profile + Theme (Right) */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-100/50 dark:bg-zinc-900/50 border border-slate-200/40 dark:border-zinc-800/50 rounded-xl pl-2.5 pr-1.5 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <select
              value={userProfile}
              onChange={(e) => setUserProfile(e.target.value)}
              className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-zinc-200 outline-none cursor-pointer pr-0.5"
            >
              <option value="All Users">All Profiles</option>
              {dashboardData.uniqueProfiles.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2.5 rounded-xl bg-slate-100/50 dark:bg-zinc-900/50 border border-slate-200/40 dark:border-zinc-800/50 text-slate-500 dark:text-zinc-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-pointer select-none"
            title="Toggle Theme"
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {/* Thin loading indicator while dashboard data refreshes */}
      {isLoadingDashboard && (
        <div className="fixed top-0 left-0 right-0 h-0.5 z-50 overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-sky-500 via-sky-500 to-sky-500 animate-loading-bar rounded-full" />
        </div>
      )}

      {/* RECURRING CHARGE RECATEGORIZE POPUP */}
      {chargeMenu && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setChargeMenu(null)}
        >
          <div
            className="animate-pop bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-zinc-800 w-full max-w-sm p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white flex items-center justify-center shadow-md flex-shrink-0">
                  <SlidersHorizontal size={18} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm leading-tight">Recategorize charge</h3>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium truncate">{chargeMenu.merchant}</p>
                </div>
              </div>
              <button onClick={() => setChargeMenu(null)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="flex items-center justify-between text-xs bg-slate-50 dark:bg-zinc-800/40 rounded-lg px-3 py-2 border border-slate-100 dark:border-zinc-800">
              <span className="font-mono text-slate-500 dark:text-zinc-400">{chargeMenu.date}</span>
              <span className={`font-black font-mono ${chargeMenu.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-zinc-200'}`}>
                {chargeMenu.amount > 0 ? '+' : '-'}${Math.abs(chargeMenu.amount).toFixed(2)}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Category</label>
              <select
                value={chargeMenu.category}
                onChange={(e) => setChargeMenu(prev => ({ ...prev, category: e.target.value }))}
                className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="">Select category…</option>
                {chargeMenu.category && !['Income','Expense','Savings','Transfer'].some(t => categories[t]?.includes(chargeMenu.category)) && (
                  <option value={chargeMenu.category}>{chargeMenu.category} (current)</option>
                )}
                <optgroup label="Income">{categories.Income.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                <optgroup label="Expenses">{categories.Expense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                <optgroup label="Savings">{categories.Savings.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                <optgroup label="Transfer">{(categories.Transfer || []).map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
              </select>
            </div>

            {(() => {
              const chargeYear = (chargeMenu.date || '').slice(0, 4);
              const options = [
                { value: 'one', title: 'Just this charge', desc: 'Only the one transaction above changes.' },
                { value: 'year', title: `Every ${chargeMenu.merchant} charge in ${chargeYear || 'this year'}`, desc: `Apply to all matching charges dated in ${chargeYear || 'that year'} — perfect for "all of 2026's transfers are Roth IRA."` },
                { value: 'all', title: 'All-time + save a rule', desc: `Recategorize every ${chargeMenu.merchant} charge and auto-apply to future imports.` },
              ];
              return (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Apply to</label>
                  <div className="flex flex-col gap-1.5">
                    {options.map(opt => {
                      const active = (chargeMenu.scope || 'one') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setChargeMenu(prev => ({ ...prev, scope: opt.value }))}
                          className={`flex items-start gap-2.5 text-left p-2.5 rounded-xl border transition-all cursor-pointer ${active ? 'border-sky-400 dark:border-sky-500/60 bg-sky-50/60 dark:bg-sky-950/20 ring-1 ring-sky-300/40 dark:ring-sky-700/40' : 'border-slate-200 dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-900'}`}
                        >
                          <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${active ? 'border-sky-500' : 'border-slate-300 dark:border-zinc-600'}`}>
                            {active && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
                          </span>
                          <span className="min-w-0">
                            <span className={`block text-xs font-bold ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-zinc-200'}`}>{opt.title}</span>
                            <span className="block text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 leading-snug">{opt.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setChargeMenu(null)}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleChargeRecategorize}
                disabled={isSavingCharge || !chargeMenu.category}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-sky-600 to-sky-600 hover:from-sky-700 hover:to-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-sky-500/20 flex items-center justify-center gap-2"
              >
                {isSavingCharge ? <RefreshCw size={14} className="animate-spin" strokeWidth={2} /> : <CheckCircle size={14} strokeWidth={2} />}
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MONTHLY BUDGET MANAGER POPUP */}
      {showBudgetModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setShowBudgetModal(false)}
        >
          <div
            className="animate-pop bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-zinc-800 w-full max-w-md p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white flex items-center justify-center shadow-md flex-shrink-0">
                  <DollarSign size={18} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm leading-tight">Monthly Budgets</h3>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">Set a spending cap per category</p>
                </div>
              </div>
              <button onClick={() => setShowBudgetModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0">
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Add new budget row */}
            <div className="flex items-end gap-2 bg-slate-50 dark:bg-zinc-800/40 rounded-xl p-3 border border-slate-100 dark:border-zinc-800">
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Category</label>
                <select
                  value={newBudget.category}
                  onChange={(e) => setNewBudget(prev => ({ ...prev, category: e.target.value }))}
                  className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
                >
                  <option value="">Select…</option>
                  {(categories.Expense || []).filter(c => c !== 'Uncategorized' && !(c in budgetEdits)).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 w-28">
                <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Cap ($)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newBudget.amount}
                  onChange={(e) => setNewBudget(prev => ({ ...prev, amount: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addBudgetRow(); }}
                  className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 text-xs font-black text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500"
                />
              </div>
              <button
                onClick={addBudgetRow}
                disabled={!newBudget.category || !(parseFloat(newBudget.amount) > 0)}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-colors flex-shrink-0"
                title="Add budget"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Existing budgets list */}
            <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto thin-scroll pr-1">
              {Object.keys(budgetEdits).length === 0 ? (
                <div className="text-center text-[11px] text-slate-400 dark:text-zinc-500 italic py-6">
                  No budgets yet. Pick a category and a monthly cap above.
                </div>
              ) : (
                Object.entries(budgetEdits).map(([cat, amt]) => (
                  <div key={cat} className="flex items-center gap-2 bg-slate-50/60 dark:bg-zinc-900/40 border border-slate-200/50 dark:border-zinc-800 rounded-lg px-3 py-2">
                    <span className="font-bold text-xs text-slate-700 dark:text-zinc-200 flex-1 truncate uppercase tracking-wide">{cat}</span>
                    <span className="text-[11px] text-slate-400 dark:text-zinc-500 font-extrabold">$</span>
                    <input
                      type="number"
                      min="0"
                      value={amt}
                      onChange={(e) => setBudgetEdits(prev => ({ ...prev, [cat]: e.target.value }))}
                      className="w-20 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded px-2 py-1 text-xs font-black text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={() => removeBudgetRow(cat)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors flex-shrink-0"
                      title="Remove budget"
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowBudgetModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveBudgetModal}
                className="btn-shine flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-sky-600 to-sky-600 hover:from-sky-700 hover:to-sky-700 transition-all shadow-md shadow-sky-500/20 flex items-center justify-center gap-2"
              >
                <CheckCircle size={14} strokeWidth={2} />
                Save Budgets
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATIONS */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 w-[340px] pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto animate-slide-up flex items-start gap-3 p-3.5 rounded-xl shadow-lg border backdrop-blur-md text-xs font-semibold ${
              toast.type === 'success'
                ? 'bg-white/95 dark:bg-zinc-900/95 border-emerald-200 dark:border-emerald-900/50 text-slate-700 dark:text-zinc-200'
                : toast.type === 'error'
                ? 'bg-white/95 dark:bg-zinc-900/95 border-rose-200 dark:border-rose-900/50 text-slate-700 dark:text-zinc-200'
                : 'bg-white/95 dark:bg-zinc-900/95 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200'
            }`}
          >
            <span className={`mt-0.5 flex-shrink-0 ${
              toast.type === 'success' ? 'text-emerald-500' : toast.type === 'error' ? 'text-rose-500' : 'text-sky-500'
            }`}>
              {toast.type === 'success' ? <CheckCircle2 size={15} strokeWidth={2}/> : toast.type === 'error' ? <AlertCircle size={15} strokeWidth={2}/> : <Info size={15} strokeWidth={2}/>}
            </span>
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors flex-shrink-0 cursor-pointer"
            >
              <X size={13} strokeWidth={2}/>
            </button>
          </div>
        ))}
      </div>

      {/* MAIN CONTAINER */}
      <main className="px-8 mt-8">
        
        {/* === EXECUTIVE DASHBOARD === */}
        {activeTab === 'Executive Dashboard' && (
          <div className="animate-fade-in">

          {/* Contextual filter toolbar (period presets + custom range) */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <div className="flex gap-0.5 bg-slate-100/70 dark:bg-zinc-900/70 p-1 rounded-xl border border-slate-200/60 dark:border-zinc-800">
              {['All Time', 'Last Month', 'Last 3 Months', 'Last 6 Months', 'YTD'].map(preset => {
                const isActive =
                  (preset === 'All Time' && startMonth === 'All Time' && endMonth === 'All Time') ||
                  (preset === 'Last Month' && startMonth === getMonthOffset(currentMonthStr, 1) && endMonth === getMonthOffset(currentMonthStr, 1)) ||
                  (preset === 'Last 3 Months' && startMonth === getMonthOffset(currentMonthStr, 2) && endMonth === currentMonthStr) ||
                  (preset === 'Last 6 Months' && startMonth === getMonthOffset(currentMonthStr, 5) && endMonth === currentMonthStr) ||
                  (preset === 'YTD' && startMonth === `${currentMonthStr.split('-')[0]}-01` && endMonth === currentMonthStr);
                return (
                  <button
                    key={preset}
                    onClick={() => applyPreset(preset)}
                    className={`text-[11px] font-bold py-1.5 px-3 rounded-lg transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-zinc-800 text-sky-600 dark:text-sky-400 shadow-sm ring-1 ring-slate-200/60 dark:ring-zinc-700/60'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>

            {/* Custom Date Range */}
            <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800 rounded-xl px-3 py-1.5 shadow-sm">
              <CalendarClock size={14} className="text-slate-400 dark:text-zinc-500 flex-shrink-0" strokeWidth={1.8} />
              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wide">From</span>
              <input
                type="month"
                value={startMonth === "All Time" ? "" : startMonth}
                onChange={(e) => { if (e.target.value) setStartMonth(e.target.value); }}
                className={`bg-transparent outline-none border-none text-[11px] font-bold cursor-pointer ${startMonth === "All Time" ? 'text-slate-400 dark:text-zinc-600' : 'text-slate-700 dark:text-zinc-200'}`}
              />
              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wide">To</span>
              <input
                type="month"
                value={endMonth === "All Time" ? "" : endMonth}
                onChange={(e) => { if (e.target.value) setEndMonth(e.target.value); }}
                className={`bg-transparent outline-none border-none text-[11px] font-bold cursor-pointer ${endMonth === "All Time" ? 'text-slate-400 dark:text-zinc-600' : 'text-slate-700 dark:text-zinc-200'}`}
              />
              {(startMonth !== "All Time" || endMonth !== "All Time") && (
                <button
                  onClick={() => { setStartMonth("All Time"); setEndMonth("All Time"); }}
                  className="text-slate-400 dark:text-zinc-500 hover:text-rose-500 transition-colors ml-0.5"
                  title="Clear range"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start relative">

            {/* Right Static Sidebar — KPI Stats Panel: pinned to viewport with its own scroll so it stays in place while the left column scrolls */}
            <div className="stagger-children lg:col-span-1 space-y-2.5 lg:order-2 lg:sticky lg:top-[90px] lg:self-start lg:h-[calc(100vh-104px)] lg:overflow-y-auto thin-scroll lg:pr-1.5">
              <div className="px-1">
                <h3 className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Financial Key Metrics</h3>
              </div>
                            {/* Total Income */}
              <div className="group kpi-card p-3.5 hover-lift glow-emerald transition-all duration-300 flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-emerald-500" />
                <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-450 border border-emerald-100/70 dark:border-emerald-900/40 flex items-center justify-center flex-shrink-0">
                  <TrendingUp size={16} strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Total Income</p>
                  <h2 className="text-base font-black text-emerald-500 dark:text-emerald-450 tracking-tight leading-tight tnum truncate">
                    $<AnimatedNumber value={dashboardData.kpis.income} format={(v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                  </h2>
                </div>
              </div>

              {/* Total Expenses */}
              <div className="group kpi-card p-3.5 hover-lift glow-rose transition-all duration-300 flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-500" />
                <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100/70 dark:border-rose-900/40 flex items-center justify-center flex-shrink-0">
                  <TrendingDown size={16} strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Total Expenses</p>
                  <h2 className="text-base font-black text-rose-500 dark:text-rose-450 tracking-tight leading-tight tnum truncate">
                    $<AnimatedNumber value={dashboardData.kpis.expenses} format={(v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                  </h2>
                </div>
              </div>

              {/* Net Savings */}
              <div className="group kpi-card p-3.5 hover-lift glow-sky transition-all duration-300 flex items-center gap-3.5 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-sky-500" />
                <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 border border-sky-100/70 dark:border-sky-900/40 flex items-center justify-center flex-shrink-0">
                  <DollarSign size={16} strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Net Savings</p>
                  <h2 className="text-base font-black text-sky-600 dark:text-sky-400 tracking-tight leading-tight tnum truncate">
                    $<AnimatedNumber value={dashboardData.kpis.savings} format={(v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                  </h2>
                </div>
              </div>

              {/* Savings Rate */}
              <div className="group kpi-card p-3.5 hover-lift glow-sky transition-all duration-300 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-sky-500" />
                <div className="flex items-center gap-3.5">
                  <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 border border-sky-100/70 dark:border-sky-900/40 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={16} strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Savings Rate</p>
                    <h2 className="text-base font-black text-sky-600 dark:text-sky-400 tracking-tight leading-tight tnum">
                      <AnimatedNumber value={dashboardData.kpis.savingsRate} format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 })} />%
                    </h2>
                  </div>
                </div>
                <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full mt-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-sky-500 to-sky-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, dashboardData.kpis.savingsRate))}%` }}
                  />
                </div>
              </div>

              {/* Net Cashflow (income − expenses) */}
              {(() => {
                const net = dashboardData.kpis.income - dashboardData.kpis.expenses;
                const positive = net >= 0;
                return (
                  <div className={`group kpi-card p-3.5 hover-lift transition-all duration-300 flex items-center gap-3.5 relative overflow-hidden ${positive ? 'glow-emerald' : 'glow-rose'}`}>
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${positive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${positive ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-450 border-emerald-100/70 dark:border-emerald-900/40' : 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border-rose-100/70 dark:border-rose-900/40'}`}>
                      <Activity size={16} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Net Cashflow</p>
                      <h2 className={`text-base font-black tracking-tight leading-tight tnum truncate ${positive ? 'text-emerald-500 dark:text-emerald-450' : 'text-rose-500'}`}>
                        {positive ? '+' : '−'}$<AnimatedNumber value={Math.abs(net)} format={(v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                      </h2>
                    </div>
                  </div>
                );
              })()}

              <div className="border-t border-slate-200/60 dark:border-zinc-800 my-3" />

              <div className="px-1">
                <h3 className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Recurring Cashflow</h3>
              </div>

              {/* Recurring cashflow — compact 2-col grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Active Subscriptions */}
                <div className="bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800/80 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-sky-500/30 dark:hover:border-sky-400/30 hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wide truncate">Subscriptions</p>
                  </div>
                  <h2 className="text-base font-black text-slate-900 dark:text-zinc-50 mt-1 tracking-tight truncate">
                    ${subscriptions.filter(s => s.is_active && s.flow_type === 'Expense (Subscription)').reduce((sum, s) => sum + s.monthly_burden, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h2>
                </div>

                {/* Active Savings Deposits */}
                <div className="bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800/80 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-sky-500/30 dark:hover:border-sky-400/30 hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wide truncate">Savings Deposits</p>
                  </div>
                  <h2 className="text-base font-black text-slate-900 dark:text-zinc-50 mt-1 tracking-tight truncate">
                    ${subscriptions.filter(s => s.is_active && s.flow_type === 'Savings Transfer').reduce((sum, s) => sum + s.monthly_burden, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h2>
                </div>

                {/* Active Salary Inflow */}
                <div className="bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800/80 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-sky-500/30 dark:hover:border-sky-400/30 hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wide truncate">Salary Inflow</p>
                  </div>
                  <h2 className="text-base font-black text-slate-900 dark:text-zinc-50 mt-1 tracking-tight truncate">
                    ${subscriptions.filter(s => s.is_active && s.flow_type === 'Income Inflow').reduce((sum, s) => sum + s.monthly_burden, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h2>
                </div>

                {/* Active CC AutoPay */}
                <div className="bg-white dark:bg-zinc-900 border border-slate-200/70 dark:border-zinc-800/80 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-sky-500/30 dark:hover:border-sky-400/30 hover:-translate-y-0.5 transition-all duration-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wide truncate">CC AutoPay</p>
                  </div>
                  <h2 className="text-base font-black text-slate-900 dark:text-zinc-50 mt-1 tracking-tight truncate">
                    ${subscriptions.filter(s => s.is_active && s.flow_type === 'Debt / CC Repayment').reduce((sum, s) => sum + s.monthly_burden, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h2>
                </div>
              </div>

              {/* SPENDING TRENDS — analytics summary (month-over-month) */}
              {trends && trends.available && (
                <>
                  <div className="border-t border-slate-200/60 dark:border-zinc-800 my-3" />
                  <div className="px-1 flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                      <BarChart3 size={12} strokeWidth={2.2} /> Spending Trends
                    </h3>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 whitespace-nowrap">{formatMonth(trends.currentMonth)} vs {formatMonth(trends.prevMonth)}</span>
                  </div>

                  {/* Spending + Income with sparklines */}
                  {[{ k: 'expenses', color: '#f43f5e', label: 'Spending' }, { k: 'income', color: '#10b981', label: 'Income' }].map(({ k, color, label }) => {
                    const m = trends.metrics.find(x => x.key === k);
                    if (!m) return null;
                    return (
                      <div key={k} className="kpi-card p-3 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400">{label}</p>
                          <DeltaChip value={m.delta_pct} tone={m.tone} />
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <h2 className="text-sm font-black tnum text-slate-900 dark:text-zinc-50 tracking-tight">${m.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}</h2>
                          <Sparkline data={trends.sparks[k]} color={color} width={84} height={26} />
                        </div>
                        {m.vs_avg_pct !== null && m.vs_avg_pct !== undefined && (
                          <p className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500">
                            <span className={m.tone === 'good' ? 'text-emerald-500' : m.tone === 'bad' ? 'text-rose-500' : ''}>{m.vs_avg_pct > 0 ? '+' : ''}{m.vs_avg_pct}%</span> vs 3-mo avg
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {/* Net cashflow + Savings rate */}
                  <div className="grid grid-cols-2 gap-3">
                    {(() => {
                      const net = trends.metrics.find(x => x.key === 'net');
                      const sr = trends.metrics.find(x => x.key === 'savings_rate');
                      return (
                        <>
                          <div className="kpi-card p-3 flex flex-col gap-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400 truncate">Net Flow</p>
                            <h2 className={`text-sm font-black tnum tracking-tight ${net.current >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{net.current >= 0 ? '+' : '−'}${Math.abs(net.current).toLocaleString(undefined, { maximumFractionDigits: 0 })}</h2>
                            <DeltaChip value={net.delta_pct} tone={net.tone} />
                          </div>
                          <div className="kpi-card p-3 flex flex-col gap-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400 truncate">Savings Rate</p>
                            <h2 className="text-sm font-black tnum tracking-tight text-sky-600 dark:text-sky-400">{sr.current}%</h2>
                            <DeltaChip value={sr.delta_pp} tone={sr.tone} suffix="pp" />
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Top movers */}
                  {trends.movers.length > 0 && (
                    <div className="kpi-card p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400 mb-2">Biggest Category Moves</p>
                      <div className="space-y-1.5">
                        {trends.movers.slice(0, 4).map((mv) => (
                          <div key={mv.category} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-700 dark:text-zinc-200 truncate flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${mv.tone === 'bad' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                              <span className="truncate">{mv.category}</span>
                            </span>
                            {mv.isNew ? (
                              <span className="text-[10px] font-black py-0.5 px-1.5 rounded-md border text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900/30 flex-shrink-0">NEW</span>
                            ) : (
                              <DeltaChip value={mv.delta_pct} tone={mv.tone} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Left Column - Comprehensive Interactive Panels */}
            <div className="lg:col-span-3 space-y-8 lg:order-1">

            {/* FINANCIAL HEALTH SCORE HERO */}
            {healthScore && (
              <div className="panel p-7 overflow-hidden relative">
                <div
                  className="absolute inset-x-0 top-0 h-[3px] opacity-80"
                  style={{ background: `linear-gradient(90deg, ${scoreColor(healthScore.score).soft}, ${scoreColor(healthScore.score).main})` }}
                />
                <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-100/50 dark:border-sky-900/40 flex-shrink-0">
                      <ShieldCheck size={18} strokeWidth={1.5} />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-[15px] leading-tight">Financial Health Score</h3>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">
                        A weighted analysis of your overall money health ·{' '}
                        <span className="text-sky-500 dark:text-sky-400 font-bold">
                          {userProfile === 'All Users' ? 'All Profiles' : userProfile}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {!healthScore.available ? (
                  <div className="text-center text-xs text-slate-400 dark:text-zinc-500 font-medium py-8 bg-slate-55/30 dark:bg-zinc-900/10 rounded-xl border border-dashed border-slate-200 dark:border-zinc-800">
                    {healthScore.summary}
                  </div>
                ) : (
                  <>
                  <div className="flex flex-col lg:flex-row items-center gap-8">
                    {/* Gauge + summary */}
                    <div className="flex flex-col items-center text-center flex-shrink-0 lg:w-[210px]">
                      <HealthGauge score={healthScore.score} grade={healthScore.grade} label={healthScore.label} />
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-semibold leading-snug mt-5 max-w-[220px]">
                        {healthScore.summary}
                      </p>
                    </div>

                    {/* Pillar breakdown */}
                    <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {healthScore.pillars.map((p) => {
                        const sc = statusColor(p.status);
                        return (
                          <div
                            key={p.key}
                            onClick={() => setExpandedPillar(expandedPillar === p.key ? null : p.key)}
                            className={`bg-slate-50/50 dark:bg-zinc-900/30 border rounded-xl p-3 flex flex-col gap-2 hover-lift transition-all cursor-pointer ${expandedPillar === p.key ? 'border-sky-400/70 dark:border-sky-500/50 ring-2 ring-sky-400/20' : 'border-slate-200/50 dark:border-zinc-800/80 hover:border-sky-500/20 dark:hover:border-sky-400/20'}`}
                            title="Click for detail & a tip to improve"
                          >
                            <div className="flex justify-between items-center gap-2">
                              <span className="text-[11px] font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5 truncate">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.bg}`} />
                                <span className="truncate">{p.label}</span>
                              </span>
                              <span className={`text-[11px] font-black tnum flex-shrink-0 ${sc.text}`}>{p.value}</span>
                            </div>
                            <div className="w-full bg-slate-200/60 dark:bg-zinc-800/50 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{ width: `${Math.max(0, Math.min(100, p.score))}%`, backgroundColor: sc.main }}
                              />
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium leading-snug line-clamp-2">
                              {p.detail}
                            </p>
                          </div>
                        );
                      })}

                      {/* Weight legend / CTA card */}
                      <div className="bg-gradient-to-br from-sky-50/60 to-sky-50/30 dark:from-sky-950/10 dark:to-sky-950/5 border border-sky-100/40 dark:border-sky-900/20 rounded-xl p-3 flex flex-col justify-center gap-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-sky-500/80 dark:text-sky-450/70">How it's scored</span>
                        <p className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium leading-snug">
                          Savings 30% · Cushion 20% · Budgets 20% · Subscriptions 15% · Stability 15%
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* Expanded pillar detail — click a pillar above to reveal numbers + a tip */}
                  {expandedPillar && (() => {
                      const ep = healthScore.pillars.find(p => p.key === expandedPillar);
                      if (!ep) return null;
                      const sc = statusColor(ep.status);
                      return (
                        <div className="animate-slide-up mt-4 rounded-xl border border-sky-100/60 dark:border-sky-900/30 bg-sky-50/40 dark:bg-sky-950/10 p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-2 h-2 rounded-full ${sc.bg}`} />
                              <h4 className="font-bold text-sm text-slate-800 dark:text-zinc-100">{ep.label}</h4>
                              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-zinc-500">· {ep.weight}% of score</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`text-sm font-black tnum ${sc.text}`}>{ep.score}<span className="text-[10px] text-slate-400 dark:text-zinc-500">/100</span></span>
                              <button onClick={(e) => { e.stopPropagation(); setExpandedPillar(null); }} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
                                <X size={14} strokeWidth={2} />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed mb-3">{ep.detail}</p>
                          <div className="flex items-start gap-2 rounded-lg bg-white/70 dark:bg-zinc-900/40 border border-slate-200/60 dark:border-zinc-800 p-3">
                            <Lightbulb size={15} strokeWidth={1.8} className="text-amber-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">How to improve</span>
                              <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed mt-0.5">{ep.tip}</p>
                            </div>
                          </div>
                        </div>
                      );
                  })()}
                  </>
                )}

                {/* WEALTH BUILDING — contributions + opportunity cost, nested in the same box */}
                <div className="mt-7 pt-6 border-t border-slate-100 dark:border-zinc-800/60 grid grid-cols-1 lg:grid-cols-2 gap-7">
                  {/* Retirement contributions — 3-year window (prior · current · next) */}
                  <div>
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-100/50 dark:border-sky-900/40 flex-shrink-0">
                        <Landmark size={15} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 dark:text-zinc-100 text-[13px] leading-tight">Retirement Contributions</h4>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">Prior · current · next year vs annual limits</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {(wealthInsights?.contributions || []).map(c => {
                        const years = c.years || [{ year: c.year, contributed: c.contributed, limit: c.limit, remaining: c.remaining, percent: c.percent, isCurrent: true }];
                        return (
                          <div key={c.category}>
                            <div className="flex justify-between items-baseline mb-2">
                              <span className="font-bold text-[11px] text-slate-700 dark:text-zinc-200 uppercase tracking-wide">{c.category}</span>
                              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">cap ${c.limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</span>
                            </div>
                            <div className="space-y-2">
                              {years.map(y => {
                                const pct = Math.min(100, y.percent);
                                const maxed = y.contributed >= y.limit && y.limit > 0;
                                return (
                                  <div key={y.year} className={`flex items-center gap-2.5 ${y.isCurrent ? '' : 'opacity-70'}`}>
                                    <span className={`text-[10px] font-black tnum w-8 flex-shrink-0 ${y.isCurrent ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400 dark:text-zinc-500'}`}>{y.year}</span>
                                    <div className="flex-1 h-2 bg-slate-200/60 dark:bg-zinc-800/50 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: maxed ? 'linear-gradient(90deg,#10b981,#14b8a6)' : 'linear-gradient(90deg,#0ea5e9,#38bdf8)' }} />
                                    </div>
                                    <span className="text-[10px] font-black tnum text-slate-700 dark:text-zinc-200 w-24 text-right flex-shrink-0">
                                      ${y.contributed.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                      <span className="text-slate-400 dark:text-zinc-500 font-bold"> / {(y.limit / 1000).toFixed(y.limit % 1000 === 0 ? 0 : 1)}k</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {(!wealthInsights?.contributions || wealthInsights.contributions.every(c => (c.years || []).every(y => y.contributed === 0))) && (
                        <p className="text-[11px] text-slate-400 dark:text-zinc-500 italic leading-relaxed">Categorize contribution transactions as <span className="font-bold text-sky-500">Roth IRA</span> or <span className="font-bold text-sky-500">HSA</span> in the AI Ledger and they'll fill these bars. Edit the caps in Settings.</p>
                      )}
                    </div>
                  </div>

                  {/* Opportunity cost of discretionary spending */}
                  <div>
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-100/50 dark:border-amber-900/40 flex-shrink-0">
                        <Sparkles size={15} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 dark:text-zinc-100 text-[13px] leading-tight">Opportunity Cost</h4>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">If discretionary spending had been invested instead</p>
                      </div>
                    </div>
                    {wealthInsights?.opportunityCost ? (() => {
                      const oc = wealthInsights.opportunityCost;
                      return (
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="kpi-card p-3">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">You spent</span>
                              <p className="text-lg font-black tnum text-slate-800 dark:text-zinc-100 mt-0.5">${oc.principal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                            </div>
                            <div className="kpi-card p-3">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Could be worth</span>
                              <p className="text-lg font-black tnum text-emerald-500 mt-0.5">${oc.futureValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                            </div>
                          </div>
                          <div className="rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100/50 dark:border-amber-900/30 p-3.5">
                            <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed">
                              Your <span className="font-bold">${oc.principal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> of discretionary spending since {formatMonth(oc.fromDate.slice(0, 7))}, invested at {Math.round(oc.rate * 100)}%/yr, would be worth <span className="font-bold text-emerald-500">${oc.futureValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> today — a missed <span className="font-bold text-amber-600 dark:text-amber-400">${oc.gain.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> in growth.
                            </p>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-2 font-medium">Based on {oc.count.toLocaleString()} transactions in {oc.categories.join(', ')}.</p>
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="h-[120px] flex items-center justify-center text-slate-400 dark:text-zinc-500 text-xs italic">No discretionary spending detected.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* UNIFIED PERFORMANCE & ANALYTICS CONSOLE */}
            <div className="panel p-7 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-500 via-sky-500 to-rose-500 opacity-60" />
              <div className="flex justify-between items-center mb-6 flex-wrap gap-3 border-b border-slate-100 dark:border-zinc-800/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-100/50 dark:border-sky-900/40 flex-shrink-0">
                    <Activity size={18} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-[15px] leading-tight">Cashflow Trends & Asset Structure</h3>
                    <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">
                      Income vs expenses over time and structural allocations ·{' '}
                      <span className="text-sky-500 dark:text-sky-400 font-bold">
                        {userProfile === 'All Users' ? 'All Profiles' : userProfile}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Line/Bar toggle */}
                  <div className="flex bg-slate-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-slate-200/40 dark:border-zinc-700/50 mr-2">
                    <button 
                      onClick={() => setChartType('Line')}
                      className={`text-[10px] font-bold py-1 px-3 rounded-md transition-all cursor-pointer ${chartType === 'Line' ? 'bg-white dark:bg-zinc-700 text-sky-600 dark:text-sky-300 shadow-sm' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'}`}
                    >
                      Line
                    </button>
                    <button
                      onClick={() => setChartType('Bar')}
                      className={`text-[10px] font-bold py-1 px-3 rounded-md transition-all cursor-pointer ${chartType === 'Bar' ? 'bg-white dark:bg-zinc-700 text-sky-600 dark:text-sky-300 shadow-sm' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'}`}
                    >
                      Bar
                    </button>
                    <button
                      onClick={() => setChartType('NetWorth')}
                      className={`text-[10px] font-bold py-1 px-3 rounded-md transition-all cursor-pointer ${chartType === 'NetWorth' ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-300 shadow-sm' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'}`}
                    >
                      Net Worth
                    </button>
                  </div>

                  {/* Income/Expense structure toggle */}
                  <div className="flex bg-slate-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-slate-200/40 dark:border-zinc-700/50">
                    <button 
                      onClick={() => setPieChartTab('Expense')}
                      className={`text-[10px] font-bold py-1 px-3 rounded-md transition-all cursor-pointer ${pieChartTab === 'Expense' ? 'bg-white dark:bg-zinc-700 text-sky-600 dark:text-sky-300 shadow-sm' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'}`}
                    >
                      Expenses
                    </button>
                    <button
                      onClick={() => setPieChartTab('Income')}
                      className={`text-[10px] font-bold py-1 px-3 rounded-md transition-all cursor-pointer ${pieChartTab === 'Income' ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-300 shadow-sm' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'}`}
                    >
                      Income
                    </button>
                    <button
                      onClick={() => setPieChartTab('Savings')}
                      className={`text-[10px] font-bold py-1 px-3 rounded-md transition-all cursor-pointer ${pieChartTab === 'Savings' ? 'bg-white dark:bg-zinc-700 text-sky-600 dark:text-sky-300 shadow-sm' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'}`}
                    >
                      Savings
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid content */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                {/* Left Column: Trend (60%) */}
                {(() => {
                  // Cumulative net-worth series (running income − expenses), shared by the
                  // Net Worth view that now lives inside this panel.
                  let running = 0;
                  const netWorthData = (dashboardData.trendData || []).map(m => {
                    running += (m.income || 0) - (m.expenses || 0);
                    return { month: m.month, net: Math.round(running * 100) / 100 };
                  });
                  const netWorthLast = netWorthData.length ? netWorthData[netWorthData.length - 1].net : 0;
                  const netWorthPositive = netWorthLast >= 0;
                  return (
                <div className="lg:col-span-3 flex flex-col justify-between">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                      {(() => {
                        const months = dashboardData.trendData || [];
                        const base = chartType === 'NetWorth' ? 'Net Worth Trajectory'
                          : chartType === 'Line' ? 'Cashflow History' : 'Cashflow Distribution';
                        if (months.length === 0) return base;
                        const range = `${formatMonth(months[0].month)} – ${formatMonth(months[months.length - 1].month)}`;
                        return `${base} · ${range}`;
                      })()}
                    </span>
                    {chartType === 'NetWorth' && netWorthData.length > 0 && (
                      <span className={`text-sm font-black tnum ${netWorthPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {netWorthPositive ? '+' : '−'}${Math.abs(netWorthLast).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </div>
                  <div
                    className="h-[250px] w-full"
                    role="img"
                    aria-label={`${chartType === 'NetWorth' ? 'Cumulative net worth area chart' : chartType === 'Line' ? 'Cashflow trend line chart' : 'Cashflow bar chart'} across ${(dashboardData.trendData || []).length} months.`}
                  >
                    {(dashboardData.trendData || []).length === 0 ? (
                      <Skeleton className="w-full h-full" />
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      {chartType === 'NetWorth' ? (
                        <AreaChart data={netWorthData} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gradNetWorth" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={netWorthPositive ? "#10b981" : "#f43f5e"} stopOpacity={0.22} />
                              <stop offset="100%" stopColor={netWorthPositive ? "#10b981" : "#f43f5e"} stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#27272a" : "#f1f5f9"} vertical={false} />
                          <XAxis dataKey="month" stroke={darkMode ? "#71717a" : "#94a3b8"} fontSize={10} fontWeight={600} tickLine={false} axisLine={false} tickFormatter={formatMonth} minTickGap={12} />
                          <YAxis stroke={darkMode ? "#71717a" : "#94a3b8"} fontSize={10} fontWeight={600} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip content={<CustomTooltip />} cursor={{ stroke: darkMode ? '#3f3f46' : '#cbd5e1', strokeWidth: 1 }} />
                          <Area type="monotone" dataKey="net" name="net worth" stroke={netWorthPositive ? "#10b981" : "#f43f5e"} strokeWidth={2.5} fill="url(#gradNetWorth)" dot={false} activeDot={{ r: 5, strokeWidth: 2 }} />
                        </AreaChart>
                      ) : chartType === 'Line' ? (
                        <AreaChart data={dashboardData.trendData} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                            </linearGradient>
                            <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.15} />
                              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.01} />
                            </linearGradient>
                            <linearGradient id="gradSavings" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.15} />
                              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#27272a" : "#f1f5f9"} vertical={false} />
                          <XAxis dataKey="month" stroke={darkMode ? "#71717a" : "#94a3b8"} fontSize={10} fontWeight={600} tickLine={false} axisLine={false} tickFormatter={formatMonth} minTickGap={12} />
                          <YAxis stroke={darkMode ? "#71717a" : "#94a3b8"} fontSize={10} fontWeight={600} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip content={<CustomTooltip />} cursor={{ stroke: darkMode ? '#3f3f46' : '#cbd5e1', strokeWidth: 1 }} />
                          <Area type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2.5} fill="url(#gradIncome)" dot={{ r: 2, strokeWidth: 1.5, fill: '#fff' }} activeDot={{ r: 5, strokeWidth: 2, fill: '#10b981' }} />
                          <Area type="monotone" dataKey="expenses" stroke="#f43f5e" strokeWidth={2.5} fill="url(#gradExpense)" dot={{ r: 2, strokeWidth: 1.5, fill: '#fff' }} activeDot={{ r: 5, strokeWidth: 2, fill: '#f43f5e' }} />
                          <Area type="monotone" dataKey="savings" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#gradSavings)" dot={{ r: 2, strokeWidth: 1.5, fill: '#fff' }} activeDot={{ r: 5, strokeWidth: 2, fill: '#0ea5e9' }} />
                        </AreaChart>
                      ) : (
                        <BarChart data={dashboardData.trendData} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#27272a" : "#f1f5f9"} vertical={false} />
                          <XAxis dataKey="month" stroke={darkMode ? "#71717a" : "#94a3b8"} fontSize={10} fontWeight={600} tickLine={false} axisLine={false} tickFormatter={formatMonth} minTickGap={12} />
                          <YAxis stroke={darkMode ? "#71717a" : "#94a3b8"} fontSize={10} fontWeight={600} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip content={<CustomTooltip />} cursor={{ fill: darkMode ? 'rgba(125,211,252,0.07)' : 'rgba(2,132,199,0.06)', radius: 4 }} />
                          <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="savings" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={18} />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                    )}
                  </div>
                  <div className="flex justify-center gap-6 text-[10px] font-bold text-slate-400 dark:text-zinc-500 mt-3 border-t border-slate-100 dark:border-zinc-800 pt-2.5">
                    {chartType === 'NetWorth' ? (
                      <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${netWorthPositive ? 'bg-emerald-500' : 'bg-rose-500'}`} /> Cumulative net worth (income − expenses)</span>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full" /> Income</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-rose-500 rounded-full" /> Expenses</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-sky-500 rounded-full" /> Net Savings</span>
                      </>
                    )}
                  </div>
                </div>
                  );
                })()}
                <div className="lg:col-span-2 border-t lg:border-t-0 lg:border-l border-slate-200/50 dark:border-zinc-800/80 pt-6 lg:pt-0 lg:pl-8 flex flex-col justify-between">
                  {(() => {
                    const rawData = pieChartTab === 'Expense' ? dashboardData.expenseData
                      : pieChartTab === 'Income' ? dashboardData.incomeData
                      : dashboardData.savingsData;
                    const sortedData = [...(rawData || [])].sort((a, b) => b.value - a.value);
                    const totalSum = sortedData.reduce((acc, curr) => acc + curr.value, 0) || 1;

                    if (sortedData.length === 0) {
                      return <div className="h-[210px] flex items-center justify-center text-slate-400 dark:text-zinc-500 text-xs italic">No items recorded.</div>;
                    }

                    return (
                      <div className="flex flex-col gap-4 w-full">
                        <div className="flex flex-col sm:flex-row lg:flex-col items-center justify-between gap-4">
                          <div
                            className="w-[140px] h-[140px] flex-shrink-0"
                            role="img"
                            aria-label={`${pieChartTab} breakdown by category, ${sortedData.length} categories totaling $${totalSum.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`}
                          >
                            <ResponsiveContainer width={140} height={140} minWidth={0}>
                              <PieChart>
                                <Pie
                                  data={sortedData}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={42}
                                  outerRadius={62}
                                  paddingAngle={3}
                                  dataKey="value"
                                >
                                  {sortedData.map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={COLORS[index % COLORS.length]} 
                                      onClick={() => setSelectedCategory(selectedCategory === entry.name ? null : entry.name)}
                                      className="cursor-pointer outline-none transition-opacity duration-200 hover:opacity-85"
                                    />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(value, name) => [`$${Number(value).toLocaleString()}`, name]}
                                  contentStyle={{ background: darkMode ? '#0e1223' : '#ffffff', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`, borderRadius: 10, fontSize: 11, fontWeight: 700, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}
                                  itemStyle={{ color: darkMode ? '#f8fafc' : '#0f172a' }}
                                  labelStyle={{ color: darkMode ? '#94a3b8' : '#64748b' }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="flex-1 max-h-[160px] overflow-y-auto thin-scroll pl-2 space-y-2.5 w-full">
                            {sortedData.map((item, index) => {
                              const pct = ((item.value / totalSum) * 100).toFixed(1);
                              const isSelected = selectedCategory === item.name;
                              return (
                                <div 
                                  key={item.name} 
                                  onClick={() => setSelectedCategory(isSelected ? null : item.name)}
                                  className={`space-y-1 p-1.5 -m-1 rounded-lg hover:bg-slate-100/60 dark:hover:bg-zinc-800/60 cursor-pointer transition-colors ${isSelected ? 'bg-slate-100/80 dark:bg-zinc-800/80 ring-1 ring-slate-200/50 dark:ring-zinc-700/50' : ''}`}
                                >
                                  <div className="flex justify-between items-center text-[11px] font-bold">
                                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 truncate max-w-[120px]">
                                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                      <span className="truncate text-slate-700 dark:text-zinc-200 font-semibold">{item.name}</span>
                                    </div>
                                    <span className="text-slate-800 dark:text-zinc-100 font-extrabold flex items-center gap-1 flex-shrink-0">
                                      <span>${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">({pct}%)</span>
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full rounded-full transition-all duration-500" 
                                      style={{ width: `${pct}%`, backgroundColor: COLORS[index % COLORS.length] }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Top Category Vendors/Sources Insights */}
                        {(() => {
                          const activeCat = selectedCategory || sortedData[0]?.name;
                          if (!activeCat) return null;
                          const vendors = pieChartTab === 'Expense'
                            ? (dashboardData.categoryMerchants?.[activeCat] || [])
                            : pieChartTab === 'Income'
                            ? (dashboardData.categorySources?.[activeCat] || [])
                            : (dashboardData.categorySavings?.[activeCat] || []);
                          const vendorLabel = pieChartTab === 'Expense' ? 'Vendors' : pieChartTab === 'Income' ? 'Inflows' : 'Sources';
                          
                          return (
                            <div className="bg-slate-50 dark:bg-zinc-950/45 p-3.5 rounded-xl border border-slate-200/40 dark:border-zinc-800/80 animate-fade-in mt-1 flex flex-col gap-2 shadow-sm">
                              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-zinc-500">
                                <span>
                                  Top {vendorLabel} · <span className="text-sky-500 dark:text-sky-400 font-extrabold">{activeCat}</span>
                                </span>
                                {selectedCategory && (
                                  <button 
                                    onClick={() => setSelectedCategory(null)}
                                    className="text-[10px] text-sky-500 hover:text-sky-700 dark:hover:text-sky-400 font-black cursor-pointer outline-none"
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                              {vendors.length === 0 ? (
                                <div className="text-[10px] text-slate-400 dark:text-zinc-600 italic">No details recorded for this category.</div>
                              ) : (
                                <div className="space-y-1.5">
                                  {vendors.map((v, vIdx) => (
                                    <div key={v.name} className="flex justify-between items-center text-[10px] font-bold">
                                      <span className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 truncate max-w-[180px]">
                                        <span className="text-[10px] font-black text-slate-300 dark:text-zinc-600 w-3 flex-shrink-0">{vIdx + 1}</span>
                                        <span className="truncate">{v.name}</span>
                                      </span>
                                      <span className="text-slate-800 dark:text-zinc-200 font-extrabold font-mono">${v.value.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* SECONDARY ROW: BUDGETS & CARDS */}
            <div className="stagger-children grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Monthly Budget Tracker */}
              <div className="panel p-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm">Active Monthly Budgets</h3>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">
                        {dashboardData.budgetTracking?.[0]?.month
                          ? `Spending so far in ${formatMonth(dashboardData.budgetTracking[0].month)} vs your caps`
                          : 'Tracking actual spending vs set monthly limits'}
                      </p>
                    </div>
                    <button
                      onClick={openBudgetModal}
                      className="inline-flex items-center gap-1.5 text-[10px] font-bold bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 py-1 px-2.5 rounded-lg border border-sky-100/50 dark:border-sky-900/40 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal size={11} strokeWidth={2} /> Manage
                    </button>
                  </div>

                  {(() => {
                    const activeBudgets = (dashboardData.budgetTracking || []).filter(track => track.budget > 0);
                    if (activeBudgets.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50/50 dark:bg-zinc-800/10 rounded-xl border border-dashed border-slate-200 dark:border-zinc-800 p-4">
                          <DollarSign size={20} className="text-slate-400 dark:text-zinc-500 mb-2" />
                          <h5 className="text-xs font-bold text-slate-700 dark:text-zinc-300">No Active Budgets</h5>
                          <p className="text-[11px] text-slate-400 dark:text-zinc-500 max-w-xs mt-1">Set a monthly cap per category to track your spending.</p>
                          <button
                            onClick={openBudgetModal}
                            className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-white bg-sky-600 hover:bg-sky-700 transition-colors uppercase tracking-wider cursor-pointer py-1.5 px-3 rounded-lg shadow-sm"
                          >
                            <Plus size={12} strokeWidth={2.2} /> Set Budget Caps
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3 max-h-[240px] overflow-y-auto thin-scroll pr-1 mt-2">
                        {activeBudgets.map((track) => {
                          const pct = track.percent;
                          let hue = 140;
                          if (pct > 50) {
                            hue = Math.max(0, 140 - ((pct - 50) * (140 / 50)));
                          }
                          const barColor = `hsl(${hue}, 80%, 45%)`;
                          const bgColor = `hsl(${hue}, 80%, 96%)`;
                          const textColor = `hsl(${hue}, 80%, 25%)`;

                          return (
                            <div key={track.category} onClick={openBudgetModal} title="Manage budgets" className="bg-slate-50/50 dark:bg-zinc-900/30 border border-slate-200/50 dark:border-zinc-800/80 p-3.5 rounded-xl flex flex-col justify-between hover-lift hover:border-sky-500/20 dark:hover:border-sky-400/20 transition-all cursor-pointer">
                              <div className="flex justify-between items-start mb-1.5">
                                <div>
                                  <h4 className="font-bold text-xs text-slate-700 dark:text-zinc-200 uppercase tracking-wide">{track.category}</h4>
                                  <span className="text-[10px] text-slate-400 dark:text-zinc-550 font-bold">
                                    Limit: ${track.budget.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <span className="text-xs font-black text-slate-800 dark:text-zinc-100 font-mono">
                                  ${track.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>

                              <div className="space-y-2 mt-2.5">
                                <div className="w-full h-1.5 bg-slate-200/60 dark:bg-zinc-800/50 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full rounded-full transition-all duration-500" 
                                    style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, hsl(${hue}, 80%, 55%) 0%, ${barColor} 100%)` }}
                                  />
                                </div>
                                <div className="flex justify-between items-center text-[10px] font-bold">
                                  <span className="py-0.5 px-2 rounded-md text-[10px] font-extrabold border" style={{ backgroundColor: darkMode ? 'rgba(30, 41, 59, 0.3)' : bgColor, color: darkMode ? barColor : textColor, borderColor: darkMode ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                                    {pct >= 100 ? 'Limit Breached' : `${pct.toFixed(0)}% Used`}
                                  </span>
                                  <span className="text-slate-400 dark:text-zinc-550">
                                    ${Math.max(0, track.budget - track.actual).toLocaleString(undefined, { minimumFractionDigits: 2 })} left
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Spending by Card / Account */}
              <div className="panel p-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm">Spending by Card / Account</h3>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">Track card balance loading across accounts</p>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[240px] overflow-y-auto thin-scroll pr-1 mt-2">
                    {dashboardData.cardBreakdown.length === 0 ? (
                      <div className="text-center text-slate-400 dark:text-zinc-500 text-xs italic py-10">No card tracking data available.</div>
                    ) : (() => {
                      const sortedCards = [...dashboardData.cardBreakdown].sort((a, b) => b.value - a.value);
                      const totalSpending = dashboardData.kpis.expenses || 1;
                      
                      return sortedCards.map((card, index) => {
                        const percent = Math.min(100, Math.round((card.value / totalSpending) * 100));
                        const theme = getCardTheme(card.name, index);
                        
                        return (
                          <div key={card.name} className="space-y-3 bg-slate-50/50 dark:bg-zinc-900/30 p-3.5 rounded-xl border border-slate-200/50 dark:border-zinc-800/80 hover-lift hover:border-sky-500/20 dark:hover:border-sky-400/20 transition-all cursor-pointer">
                            <div className="flex justify-between items-center text-xs font-bold">
                              <span className="flex items-center gap-2.5 text-slate-700 dark:text-zinc-200 truncate max-w-[170px]">
                                <div 
                                  className="w-6 h-4 rounded flex items-center justify-center text-[7px] font-black text-white/95 flex-shrink-0 shadow-sm relative overflow-hidden"
                                  style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
                                >
                                  {/* Hologram/Microchip simulation */}
                                  <span className="absolute top-1 left-1 w-1.5 h-1 bg-yellow-400/70 rounded-[1px] opacity-80" />
                                  <span className="relative z-10 pl-1">{theme.badge}</span>
                                </div>
                                <span className="truncate text-slate-800 dark:text-zinc-100 font-semibold">{card.name}</span>
                              </span>
                              <span className="text-slate-950 dark:text-zinc-50 font-black flex items-center gap-1.5 flex-shrink-0 font-mono">
                                <span>${card.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span className="text-[10px] text-slate-400 dark:text-zinc-550 font-bold">({percent}%)</span>
                              </span>
                            </div>
                            <div className="w-full bg-slate-200/60 dark:bg-zinc-800/50 h-1.5 rounded-full overflow-hidden">
                              <div 
                                className="h-full rounded-full transition-all duration-500"
                                style={{ 
                                  width: `${percent}%`,
                                  background: `linear-gradient(90deg, ${theme.from}, ${theme.to})`
                                }}
                              />
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* TOP MERCHANTS & INCOME SOURCES GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Where Expenses Go (Top Merchants) */}
              <div className="panel p-6">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown size={14} className="text-rose-500" strokeWidth={2}/>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-100 text-sm">Top Spending Destinations</h4>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium mb-4">Where most of your money goes in the selected period</p>
                <div className="space-y-3.5">
                  {dashboardData.topMerchants.length === 0 ? (
                    <div className="text-slate-400 dark:text-zinc-500 text-xs italic py-4">No transactions found.</div>
                  ) : dashboardData.topMerchants.map((item, index) => {
                    const maxVal = dashboardData.topMerchants[0].value || 1;
                    const percentage = Math.round((item.value / maxVal) * 100);
                    return (
                      <div key={item.name} className="space-y-1">
                        <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-zinc-200">
                          <span className="flex items-center gap-2 truncate max-w-[220px]">
                            <span className="w-4 h-4 rounded-md bg-rose-50 dark:bg-rose-950/30 text-rose-500 dark:text-rose-400 text-[10px] font-black flex items-center justify-center flex-shrink-0">{index + 1}</span>
                            <span className="truncate">{item.name}</span>
                          </span>
                          <span className="tnum">${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-rose-400 to-rose-600 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Where Income Comes From (Top Sources) */}
              <div className="panel p-6">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={14} className="text-emerald-500" strokeWidth={2}/>
                  <h4 className="font-bold text-slate-800 dark:text-zinc-100 text-sm">Top Inflow Sources</h4>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium mb-4">Where your income comes from in the selected period</p>
                <div className="space-y-3.5">
                  {dashboardData.topSources.length === 0 ? (
                    <div className="text-slate-400 dark:text-zinc-500 text-xs italic py-4">No income sources found.</div>
                  ) : dashboardData.topSources.map((item, index) => {
                    const maxVal = dashboardData.topSources[0].value || 1;
                    const percentage = Math.round((item.value / maxVal) * 100);
                    return (
                      <div key={item.name} className="space-y-1">
                        <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-zinc-200">
                          <span className="flex items-center gap-2 truncate max-w-[220px]">
                            <span className="w-4 h-4 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 dark:text-emerald-400 text-[10px] font-black flex items-center justify-center flex-shrink-0">{index + 1}</span>
                            <span className="truncate">{item.name}</span>
                          </span>
                          <span className="tnum">${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div> {/* Closes the Top Merchants & Sources Grid */}

            {/* RECURRING CASH FLOWS DIRECTORY */}
            {(() => {
              const FLOW_META = {
                'Income Inflow': { label: 'Income', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' },
                'Savings Transfer': { label: 'Savings', dot: 'bg-sky-500', badge: 'bg-sky-50 text-sky-600 border-sky-100 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/30' },
                'Expense (Subscription)': { label: 'Subscriptions', dot: 'bg-rose-500', badge: 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30' },
                'Debt / CC Repayment': { label: 'CC AutoPay', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30' },
                'Other Inflow': { label: 'Other Inflows', dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700' }
              };

              const visibleSubs = subscriptions.filter(sub =>
                (showInactiveSubs || sub.is_active) &&
                (subFilter === 'All' || sub.flow_type === subFilter) &&
                (!subSearch.trim() || sub.merchant.toLowerCase().includes(subSearch.trim().toLowerCase()))
              );

              const activeSubs = subscriptions.filter(s => s.is_active);
              const monthlyIn = activeSubs.filter(s => s.flow_type === 'Income Inflow').reduce((a, s) => a + s.monthly_burden, 0);
              const monthlyOut = activeSubs.filter(s => ['Expense (Subscription)', 'Savings Transfer'].includes(s.flow_type)).reduce((a, s) => a + s.monthly_burden, 0);
              const fmtUSD = (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

              return (
                <div className="panel overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-5 border-b border-slate-200/60 dark:border-zinc-800 flex justify-between items-center flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-100/50 dark:border-sky-900/40 flex-shrink-0">
                        <Repeat size={17} strokeWidth={1.5}/>
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm leading-tight">Recurring Cash Flows</h3>
                        <p className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">
                          Auto-detected repeating income, savings, subscriptions and card payments ·{' '}
                          <span className="text-sky-500 dark:text-sky-400 font-bold">
                            {userProfile === 'All Users' ? 'All Profiles' : userProfile}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                      {/* Search */}
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" strokeWidth={2}/>
                        <input
                          type="text"
                          placeholder="Search merchant..."
                          value={subSearch}
                          onChange={(e) => setSubSearch(e.target.value)}
                          className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 outline-none w-44 focus:bg-white dark:focus:bg-zinc-800 focus:border-sky-500 transition-colors"
                        />
                      </div>

                      {/* Show stopped toggle */}
                      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wide bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-2">
                        <input
                          type="checkbox"
                          checked={showInactiveSubs}
                          onChange={(e) => setShowInactiveSubs(e.target.checked)}
                          className="rounded border-slate-300 dark:border-zinc-700 text-sky-600 focus:ring-sky-500 cursor-pointer h-3 w-3"
                        />
                        <span>Show stopped</span>
                      </label>
                    </div>
                  </div>

                  {/* Flow type summary chips (also act as filters) */}
                  <div className="px-6 py-3.5 border-b border-slate-200/60 dark:border-zinc-800 flex gap-2 flex-wrap bg-slate-50/50 dark:bg-zinc-900/30">
                    {['All', ...Object.keys(FLOW_META).filter(t => t !== 'Other Inflow')].map(type => {
                      const isActiveChip = subFilter === type;
                      const typeSubs = type === 'All' ? activeSubs : activeSubs.filter(s => s.flow_type === type);
                      const total = typeSubs.reduce((a, s) => a + s.monthly_burden, 0);
                      const meta = FLOW_META[type];
                      return (
                        <button
                          key={type}
                          onClick={() => setSubFilter(isActiveChip && type !== 'All' ? 'All' : type)}
                          className={`flex items-center gap-2 py-1.5 px-3 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
                            isActiveChip
                              ? 'bg-white dark:bg-zinc-800 border-sky-300 dark:border-sky-700/60 text-slate-800 dark:text-zinc-100 shadow-sm ring-1 ring-sky-200/50 dark:ring-sky-800/40'
                              : 'bg-white/60 dark:bg-zinc-900/60 border-slate-200/70 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:border-slate-300 dark:hover:border-zinc-700'
                          }`}
                        >
                          {meta && <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />}
                          <span>{type === 'All' ? 'All Flows' : meta.label}</span>
                          <span className="text-[10px] font-black text-slate-400 dark:text-zinc-500">({typeSubs.length})</span>
                          <span className="tnum text-[10px] font-extrabold text-slate-700 dark:text-zinc-300">{fmtUSD(total)}/mo</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="overflow-x-auto overflow-y-auto max-h-[440px] thin-scroll">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm">
                        <tr className="text-slate-400 dark:text-zinc-500 text-[10px] font-black uppercase tracking-wider border-b border-slate-200/70 dark:border-zinc-800">
                          <th className="py-3 px-4 pl-6">Merchant / Source</th>
                          <th className="py-3 px-4 text-center">Flow Type</th>
                          <th className="py-3 px-4">Account</th>
                          <th className="py-3 px-4 text-center">Frequency</th>
                          <th className="py-3 px-4 text-right">Avg Amount</th>
                          <th className="py-3 px-4 text-right">Monthly Eq.</th>
                          <th className="py-3 px-4 text-center">Last Seen</th>
                          <th className="py-3 px-4 text-center">Next Expected</th>
                          <th className="py-3 px-4 pr-6 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                        {visibleSubs.length === 0 ? (
                          <tr>
                            <td colSpan="9" className="p-12 text-center">
                              <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-zinc-500">
                                <Repeat size={22} strokeWidth={1.5} className="text-slate-300 dark:text-zinc-600"/>
                                <span className="text-xs font-bold">No matching recurring flows</span>
                                <span className="text-[11px] font-medium">Try a different filter, search term, or enable “Show stopped”.</span>
                              </div>
                            </td>
                          </tr>
                        ) : visibleSubs.map((sub, idx) => {
                          const key = `${sub.merchant}-${sub.person}-${idx}`;
                          const isExpanded = expandedSub === key;
                          const meta = FLOW_META[sub.flow_type] || FLOW_META['Other Inflow'];
                          const isOverdue = sub.is_active && sub.next_due && sub.next_due < new Date().toISOString().slice(0, 10);
                          return (
                            <React.Fragment key={key}>
                              <tr
                                onClick={() => setExpandedSub(isExpanded ? null : key)}
                                className={`border-b border-slate-100 dark:border-zinc-800/70 hover:bg-slate-50/70 dark:hover:bg-zinc-800/50 transition-all cursor-pointer ${!sub.is_active ? 'opacity-55' : ''}`}
                              >
                                <td className="py-3 px-4 pl-6">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800 dark:text-zinc-100">{sub.merchant}</span>
                                    {userProfile === 'All Users' && (
                                      <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-800 py-0.5 px-1.5 rounded uppercase tracking-wide">{sub.person}</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <span className={`inline-block py-0.5 px-2.5 rounded-full text-[10px] font-bold border ${meta.badge}`}>
                                    {meta.label}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 py-0.5 px-2 rounded-md font-semibold font-mono text-[10px]">
                                    <CreditCard size={10} strokeWidth={1.5}/>
                                    {sub.card}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <span className={`inline-block py-0.5 px-2.5 rounded-full text-[10px] font-bold border ${
                                    sub.frequency === 'Weekly' ? 'bg-cyan-50 text-cyan-600 border-cyan-100 dark:bg-cyan-950/20 dark:text-cyan-400 dark:border-cyan-900/30' :
                                    sub.frequency === 'Monthly' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' :
                                    sub.frequency === 'Annually' ? 'bg-sky-50 text-sky-600 border-sky-100 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/30' :
                                    'bg-sky-50 text-sky-600 border-sky-100 dark:bg-sky-950/20 dark:text-sky-400 dark:border-sky-900/30'
                                  }`}>
                                    {sub.frequency}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-zinc-100 tnum">${sub.avg_amount.toFixed(2)}</td>
                                <td className="py-3 px-4 text-right font-black text-sky-600 dark:text-sky-400 tnum">${sub.monthly_burden.toFixed(2)}</td>
                                <td className="py-3 px-4 text-center text-slate-500 dark:text-zinc-400 font-mono text-[11px]">{sub.last_date}</td>
                                <td className="py-3 px-4 text-center">
                                  {sub.is_active && sub.next_due ? (
                                    <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${isOverdue ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500 dark:text-zinc-400'}`}>
                                      <CalendarClock size={11} strokeWidth={1.5}/>
                                      {sub.next_due}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 dark:text-zinc-600">—</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 pr-6 text-center">
                                  {sub.is_active ? (
                                    <span className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 py-0.5 px-2.5 rounded-full text-[10px] font-bold border border-emerald-100 dark:border-emerald-900/30">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                      Active
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 py-0.5 px-2.5 rounded-full text-[10px] font-bold border border-slate-200 dark:border-zinc-700">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                      Stopped
                                    </span>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-slate-50/50 dark:bg-zinc-950/20 border-b border-slate-200 dark:border-zinc-800/80">
                                  <td colSpan="9" className="p-4 pl-12 pr-6">
                                    <div className="flex flex-col gap-3 animate-fade-in text-slate-500 dark:text-zinc-400">
                                      <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider border-b border-slate-200/50 dark:border-zinc-800/60 pb-1.5">
                                        <span>Payment History ({sub.count} occurrences)</span>
                                        <span>Typical Billing Day: {sub.day_of_month} of the month</span>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                                        {sub.charges?.slice(0, 12).map((charge, cIdx) => (
                                          <button
                                            type="button"
                                            key={cIdx}
                                            disabled={!charge.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setChargeMenu({
                                                id: charge.id,
                                                merchant: sub.merchant,
                                                date: charge.date,
                                                amount: charge.amount,
                                                category: charge.category || '',
                                                scope: 'one',
                                              });
                                            }}
                                            title={charge.id ? 'Click to recategorize this charge' : ''}
                                            className={`group/charge text-left bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-slate-200/50 dark:border-zinc-800/80 flex flex-col gap-0.5 shadow-sm transition-all ${charge.id ? 'cursor-pointer hover:border-sky-400 hover:shadow-md' : 'cursor-default'}`}
                                          >
                                            <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">{charge.date}</span>
                                            <span className="text-xs font-black text-slate-800 dark:text-zinc-200 font-mono">
                                              {charge.amount > 0 ? '+' : '-'}${Math.abs(charge.amount).toFixed(2)}
                                            </span>
                                            {charge.category && (
                                              <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-bold text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 self-start max-w-full truncate">
                                                {charge.category}
                                                {charge.id && <SlidersHorizontal size={9} strokeWidth={2} className="opacity-0 group-hover/charge:opacity-60 transition-opacity flex-shrink-0" />}
                                              </span>
                                            )}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Net monthly footer */}
                  <div className="px-6 py-3.5 bg-slate-50/70 dark:bg-zinc-900/40 border-t border-slate-200/60 dark:border-zinc-800 flex justify-end items-center gap-6 text-[11px] font-bold flex-wrap">
                    <span className="text-slate-400 dark:text-zinc-500 uppercase tracking-wider text-[10px] font-black">Active Monthly Recurring</span>
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <TrendingUp size={12} strokeWidth={2}/> In {fmtUSD(monthlyIn)}
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                      <TrendingDown size={12} strokeWidth={2}/> Out {fmtUSD(monthlyOut)}
                    </span>
                    <span className={`flex items-center gap-1.5 ${monthlyIn - monthlyOut >= 0 ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      Net {fmtUSD(monthlyIn - monthlyOut)}
                    </span>
                  </div>
                </div>
              );
            })()}

          </div>

          </div>

          </div>
      )}

        {/* === DATA PIPELINE TAB === */}
        {activeTab === 'Data Pipeline' && (
          <div className="space-y-8 animate-fade-in">

            {/* === BANK CONNECTIONS (PLAID) === */}
            <div className="panel p-8">
              <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shadow-emerald-200/70 flex-shrink-0">
                    <Building2 size={20} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-100 leading-tight">Bank Connections</h2>
                    <p className="text-xs text-slate-400 dark:text-zinc-500 font-semibold">Securely link accounts via Plaid — transactions import automatically</p>
                  </div>
                </div>
                {plaidConfigured && plaidItems.length > 0 && (
                  <button
                    onClick={() => handlePlaidSync(null)}
                    disabled={plaidSyncing}
                    className={`flex items-center gap-2 font-bold py-2.5 px-5 rounded-xl border text-xs transition-all shadow-md ${
                      plaidSyncing
                        ? 'bg-slate-100 text-slate-400 dark:text-zinc-500 border-slate-200 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white border-transparent shadow-emerald-200'
                    }`}
                  >
                    {plaidSyncing ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <RefreshCw size={14} strokeWidth={1.5}/>}
                    <span>Sync All Banks</span>
                  </button>
                )}
              </div>

              {plaidConfigured && (
                <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/30 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-800 dark:text-zinc-100">Import mode</p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                      {settings.ingest_mode === 'plaid'
                        ? 'Plaid only — all manual CSV uploads are disabled to prevent duplicate transactions.'
                        : 'CSV uploads allowed. Any profile already linked to Plaid is automatically blocked from CSV to prevent duplicates.'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSaveSettings({ ...settings, ingest_mode: settings.ingest_mode === 'plaid' ? 'csv' : 'plaid' })}
                    className={`flex items-center gap-2 font-bold py-2 px-4 rounded-xl border text-xs transition-all shadow-sm flex-shrink-0 ${
                      settings.ingest_mode === 'plaid'
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white border-transparent shadow-emerald-200'
                        : 'bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700'
                    }`}
                  >
                    {settings.ingest_mode === 'plaid' ? 'Plaid mode' : 'CSV mode'}
                  </button>
                </div>
              )}

              {plaidConfigured && !showPlaidConfig && (
                <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-900/30 px-5 py-3.5">
                  <div className="min-w-0 flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
                    <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" strokeWidth={2}/>
                    <span className="font-semibold">
                      Plaid keys saved · <span className="capitalize">{plaidStatus.environment}</span>
                      {plaidStatus.client_id_masked ? ` · ${plaidStatus.client_id_masked}` : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowPlaidConfig(true)}
                    className="font-bold py-2 px-4 rounded-xl border text-xs transition-all shadow-sm flex-shrink-0 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-700"
                  >
                    Update keys
                  </button>
                </div>
              )}

              {(!plaidConfigured || showPlaidConfig) ? (
                <div className="rounded-2xl border border-slate-200/70 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/20 p-6">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-600 to-blue-500 text-white flex items-center justify-center shadow-sm flex-shrink-0">
                      <KeyRound size={17} strokeWidth={1.5}/>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-base text-slate-800 dark:text-zinc-100">
                        {plaidConfigured ? 'Update Plaid credentials' : 'Connect Plaid'}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                        Paste your keys from the{' '}
                        <a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer"
                           className="font-semibold text-sky-600 dark:text-sky-400 underline">Plaid dashboard</a>.
                        They're saved securely on this machine and applied instantly — no file editing or restart needed.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 max-w-xl">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1.5">Client ID</label>
                      <input
                        type="text"
                        value={plaidForm.client_id}
                        onChange={(e) => setPlaidForm((f) => ({ ...f, client_id: e.target.value }))}
                        placeholder="e.g. 5f9a1c2b3d4e5f6a7b8c9d0e"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1.5">
                        Secret {plaidConfigured && plaidStatus.has_secret && <span className="font-normal text-slate-400">(leave blank to keep current)</span>}
                      </label>
                      <input
                        type="password"
                        value={plaidForm.secret}
                        onChange={(e) => setPlaidForm((f) => ({ ...f, secret: e.target.value }))}
                        placeholder={plaidConfigured && plaidStatus.has_secret ? '•••••••• (unchanged)' : 'Your Plaid secret'}
                        autoComplete="off"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1.5">Environment</label>
                        <select
                          value={plaidForm.env}
                          onChange={(e) => setPlaidForm((f) => ({ ...f, env: e.target.value }))}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
                        >
                          <option value="production">Production (real banks)</option>
                          <option value="sandbox">Sandbox (test banks)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-zinc-300 mb-1.5">
                          Redirect URI <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={plaidForm.redirect_uri}
                          onChange={(e) => setPlaidForm((f) => ({ ...f, redirect_uri: e.target.value }))}
                          placeholder="http://localhost:5173"
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-zinc-500 leading-relaxed">
                      Redirect URI is only needed for OAuth banks (Chase, Wells Fargo, Capital One…). It must match a URI
                      registered under Plaid → Team Settings → API → Allowed redirect URIs.
                    </p>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={handleSavePlaidConfig}
                        disabled={plaidSavingConfig}
                        className={`flex items-center gap-2 font-bold py-2.5 px-5 rounded-xl border text-xs transition-all shadow-md ${
                          plaidSavingConfig
                            ? 'bg-slate-100 text-slate-400 dark:text-zinc-500 border-slate-200 cursor-not-allowed'
                            : 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white border-transparent shadow-emerald-200'
                        }`}
                      >
                        {plaidSavingConfig ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <CheckCircle2 size={14} strokeWidth={1.5}/>}
                        <span>{plaidSavingConfig ? 'Saving…' : 'Save & connect'}</span>
                      </button>
                      {plaidConfigured && (
                        <button
                          onClick={() => { setShowPlaidConfig(false); setPlaidForm((f) => ({ ...f, secret: '' })); }}
                          className="font-bold py-2.5 px-5 rounded-xl border text-xs bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-700"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {(() => {
                    const profiles = (dashboardData.uniqueProfiles && dashboardData.uniqueProfiles.length)
                      ? dashboardData.uniqueProfiles
                      : [...new Set(settings.declared_banks.map((b) => b.owner))];
                    const list = profiles.length ? profiles : ['big_boo', 'lil_boo'];
                    return list.filter((p) => p && p !== 'All Users').map((person) => {
                      const conns = plaidItems.filter((i) => i.person === person);
                      const isConnecting = plaidConnecting === person;
                      return (
                        <section key={person} className="rounded-2xl border border-slate-200/60 dark:border-zinc-800/80 p-5 bg-white/40 dark:bg-zinc-900/20">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center font-black text-sm shadow-sm flex-shrink-0">
                                {person.charAt(0).toUpperCase()}
                              </div>
                              <h3 className="font-black text-sm text-slate-800 dark:text-zinc-100 capitalize truncate">{person.replace(/_/g, ' ')}</h3>
                            </div>
                            <button
                              onClick={() => handleConnectBank(person)}
                              disabled={isConnecting}
                              className={`flex items-center gap-2 font-bold py-2 px-4 rounded-xl border text-xs transition-all shadow-sm flex-shrink-0 ${
                                isConnecting
                                  ? 'bg-slate-100 text-slate-400 dark:text-zinc-500 border-slate-200 cursor-not-allowed'
                                  : 'bg-gradient-to-r from-sky-600 to-blue-500 hover:from-sky-700 hover:to-blue-600 text-white border-transparent shadow-sky-200'
                              }`}
                            >
                              {isConnecting ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <Link2 size={14} strokeWidth={1.5}/>}
                              <span>Connect a bank</span>
                            </button>
                          </div>

                          {conns.length === 0 ? (
                            <p className="text-xs text-slate-400 dark:text-zinc-500 font-semibold pl-1">No banks linked yet — click <strong>Connect a bank</strong> to securely log in through Plaid.</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {conns.map((item) => (
                                <div key={item.item_id} className="group relative flex items-start gap-3 rounded-xl border border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/10 p-3.5">
                                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                                    <Landmark size={15} strokeWidth={1.5}/>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <h4 className="font-black text-xs text-slate-800 dark:text-zinc-100 truncate">{item.institution_name}</h4>
                                    <p className="text-[10px] text-slate-500 dark:text-zinc-400 font-semibold mt-0.5 truncate">
                                      {item.accounts && item.accounts.length ? item.accounts.join(', ') : 'Linked account'}
                                    </p>
                                    <span className="inline-flex items-center gap-1 mt-1.5 text-[9px] font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 size={10} strokeWidth={2}/> Connected
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => handleRemoveBank(item)}
                                    title="Disconnect this bank"
                                    className="text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0"
                                  >
                                    <Unlink size={15} strokeWidth={1.5}/>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            <div className="panel p-8">
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-blue-500 text-white flex items-center justify-center shadow-md shadow-sky-200/70 flex-shrink-0">
                  <UploadCloud size={20} strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-100 leading-tight">CSV Ingestion Slots</h2>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 font-semibold">Drop each statement into its account slot — grouped by profile for clarity</p>
                </div>
              </div>
              
              {/* Folder Scanner Button */}
              <button
                onClick={handleScanFolders}
                disabled={isScanningFolder}
                className={`flex items-center gap-2 font-bold py-2.5 px-5 rounded-xl border text-xs transition-all shadow-md ${
                  isScanningFolder 
                    ? 'bg-slate-100 text-slate-400 dark:text-zinc-500 border-slate-200 cursor-not-allowed'
                    : 'bg-gradient-to-r from-sky-600 to-blue-500 hover:from-sky-700 hover:to-blue-600 text-white border-transparent shadow-sky-200 shadow-md'
                }`}
              >
                {isScanningFolder ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <Sparkles size={14} strokeWidth={1.5}/>}
                <span>Scan & Process Statement Drops</span>
              </button>
            </div>

            {settings.declared_banks.length === 0 ? (
              <div className="text-center py-16 text-slate-400 dark:text-zinc-500 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl">
                <CreditCard size={48} className="mx-auto text-slate-300 mb-4 animate-bounce" strokeWidth={1.5}/>
                <h3 className="font-bold text-lg text-slate-700 dark:text-zinc-200">No Bank Card Slots Declared</h3>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1 max-w-sm mx-auto">
                  Before you can ingest transactions, declare your bank cards or accounts in the settings under the <strong>Settings</strong> tab!
                </p>
                <button
                  onClick={() => setActiveTab('Settings')}
                  className="mt-6 bg-sky-600 hover:bg-sky-700 text-white font-extrabold py-2.5 px-6 rounded-xl text-xs transition-all shadow-md shadow-sky-100"
                >
                  Configure Slots in Settings
                </button>
              </div>
            ) : (
              <div className="space-y-10">
                {Object.entries(
                  settings.declared_banks.reduce((groups, bank) => {
                    (groups[bank.owner] = groups[bank.owner] || []).push(bank);
                    return groups;
                  }, {})
                ).map(([owner, banks]) => {
                  // Banking accounts first, then credit cards, for a predictable reading order
                  const orderedBanks = [...banks].sort((a, b) =>
                    a.type === b.type ? 0 : a.type === 'Banking' ? -1 : 1
                  );
                  const bankingCount = banks.filter((b) => b.type === 'Banking').length;
                  const cardCount = banks.length - bankingCount;

                  return (
                    <section key={owner}>
                      {/* Profile group header */}
                      <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center font-black text-base shadow-md shadow-slate-300/50 flex-shrink-0">
                          {owner.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-black text-sm text-slate-800 dark:text-zinc-100 capitalize leading-tight">{owner.replace(/_/g, ' ')}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 rounded-full py-0.5 px-2">
                              <Landmark size={10} strokeWidth={1.5}/> {bankingCount} banking
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 rounded-full py-0.5 px-2">
                              <CreditCard size={10} strokeWidth={1.5}/> {cardCount} card{cardCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent ml-2" />
                      </div>

                      {/* This profile's account slots */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {orderedBanks.map((bank) => {
                          const isSlotUploading = uploadingSlot === bank.name;
                          const isBank = bank.type === 'Banking';
                          const accent = isBank
                            ? { grad: 'from-sky-500 to-blue-600', chip: 'bg-sky-50 text-sky-700 border-sky-100', hoverBorder: 'hover:border-sky-400', hoverText: 'group-hover:text-sky-600', hoverIcon: 'group-hover:text-sky-500' }
                            : { grad: 'from-rose-500 to-pink-600', chip: 'bg-rose-50 text-rose-700 border-rose-100', hoverBorder: 'hover:border-rose-400', hoverText: 'group-hover:text-rose-600', hoverIcon: 'group-hover:text-rose-500' };

                          return (
                            <div
                              key={bank.name}
                              className={`group relative overflow-hidden bg-white/50 dark:bg-zinc-900/30 border border-slate-200/50 dark:border-zinc-800/80 rounded-2xl p-5 flex flex-col hover-lift transition-all duration-300 ${
                                isSlotUploading ? 'ring-2 ring-sky-500/60 ring-offset-2' : ''
                              }`}
                            >
                              {/* Type-colored top accent */}
                              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent.grad}`} />

                              <div className="flex items-center gap-2.5 mb-4">
                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${accent.grad} text-white flex items-center justify-center flex-shrink-0 shadow-sm`}>
                                  {isBank ? <Landmark size={16} strokeWidth={1.5}/> : <CreditCard size={16} strokeWidth={1.5}/>}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-black text-sm text-slate-800 dark:text-zinc-100 truncate leading-tight">{bank.name}</h4>
                                  <span className={`inline-block mt-1.5 py-0.5 px-2 rounded text-[10px] font-black uppercase tracking-wide border ${accent.chip}`}>
                                    {bank.type}
                                  </span>
                                </div>
                              </div>

                              <label
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.add('dropzone-dash', 'border-sky-500/80', 'bg-sky-50/20');
                                }}
                                onDragLeave={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.remove('dropzone-dash', 'border-sky-500/80', 'bg-sky-50/20');
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.remove('dropzone-dash', 'border-sky-500/80', 'bg-sky-50/20');
                                  if (!isSlotUploading) {
                                    handleUploadSlotFiles(e.dataTransfer.files, bank);
                                  }
                                }}
                                className={`border-2 border-dashed border-slate-200/80 dark:border-zinc-700/85 rounded-xl p-6 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-zinc-800/20 hover:bg-slate-50/80 dark:hover:bg-zinc-800/40 ${accent.hoverBorder} cursor-pointer transition-all min-h-[130px] relative`}
                              >
                                {isSlotUploading ? (
                                  <div className="flex flex-col items-center justify-center space-y-3">
                                    <RefreshCw size={26} className="text-sky-600 animate-spin" strokeWidth={1.5}/>
                                    <span className="text-xs font-bold text-slate-600 dark:text-zinc-300 animate-pulse">Ingesting…</span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-center">
                                    <UploadCloud size={26} className={`text-slate-400 dark:text-zinc-500 ${accent.hoverIcon} mb-2 transition-colors`} strokeWidth={1.5}/>
                                    <h5 className={`font-black text-xs text-slate-700 dark:text-zinc-200 ${accent.hoverText} transition-colors`}>Drag &amp; drop statement</h5>
                                    <p className="text-[10px] text-slate-400 dark:text-zinc-550 mt-1 font-bold">or click to browse CSV</p>
                                  </div>
                                )}
                                <input
                                  type="file"
                                  accept=".csv"
                                  disabled={isSlotUploading}
                                  className="hidden"
                                  onChange={(e) => {
                                    if (e.target.files && e.target.files.length > 0) {
                                      handleUploadSlotFiles(e.target.files, bank);
                                    }
                                  }}
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        )}

        {/* === AI LEDGER TAB === */}
        {activeTab === 'AI Ledger' && (
          <div className="space-y-6 animate-fade-in">
            {/* Hero header */}
            <div className="panel p-6 flex items-center gap-3 overflow-hidden relative">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-500 via-sky-500 to-sky-500 opacity-70" />
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white flex items-center justify-center shadow-md shadow-sky-500/20 flex-shrink-0">
                <Sparkles size={20} strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-800 dark:text-zinc-100 leading-tight tracking-tight">AI Ledger</h2>
                <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium">Review the bot's category suggestions, resolve merchants mapped to conflicting categories, and audit your full history.</p>
              </div>
            </div>

            {/* Ledger Sub-Tabs */}
            <div className="flex gap-6 border-b border-slate-200/60 dark:border-zinc-800 pb-1 mb-2">
              <button
                onClick={() => { setLedgerSubTab('Wizard'); setWizardIndex(0); }}
                className={`pb-2.5 text-sm font-semibold transition-all relative ${
                  ledgerSubTab === 'Wizard' 
                    ? 'text-sky-600 font-bold' 
                    : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-200'
                }`}
              >
                Category Wizard ({wizardCategories.length})
                {ledgerSubTab === 'Wizard' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500 rounded-full" />
                )}
              </button>

              <button
                onClick={() => setLedgerSubTab('Conflicts')}
                className={`pb-2.5 text-sm font-semibold transition-all relative flex items-center gap-2 ${
                  ledgerSubTab === 'Conflicts' 
                    ? 'text-rose-600 font-bold' 
                    : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-200'
                }`}
              >
                <span>Category Conflicts ({conflictData.length})</span>
                {conflictData.length > 0 && (
                  <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                )}
                {ledgerSubTab === 'Conflicts' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-500 rounded-full" />
                )}
              </button>

              <button
                onClick={() => setLedgerSubTab('Audit')}
                className={`pb-2.5 text-sm font-semibold transition-all relative ${
                  ledgerSubTab === 'Audit'
                    ? 'text-sky-600 font-bold'
                    : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-200'
                }`}
              >
                Categorized History
                {ledgerSubTab === 'Audit' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500 rounded-full" />
                )}
              </button>

              <button
                onClick={() => setLedgerSubTab('Duplicates')}
                className={`pb-2.5 text-sm font-semibold transition-all relative flex items-center gap-2 ${
                  ledgerSubTab === 'Duplicates'
                    ? 'text-amber-600 font-bold'
                    : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-200'
                }`}
              >
                <span>Duplicates{(dupSummary?.removable ?? 0) > 0 ? ` (${dupSummary.removable})` : ''}</span>
                {(dupSummary?.removable ?? 0) > 0 && (
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                )}
                {ledgerSubTab === 'Duplicates' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
                )}
              </button>

              <button
                onClick={() => setLedgerSubTab('Rules')}
                className={`pb-2.5 text-sm font-semibold transition-all relative flex items-center gap-2 ${
                  ledgerSubTab === 'Rules'
                    ? 'text-sky-600 font-bold'
                    : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:text-zinc-200'
                }`}
              >
                <span>Smart Rules{smartRules.length > 0 ? ` (${smartRules.length})` : ''}</span>
                {ledgerSubTab === 'Rules' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500 rounded-full" />
                )}
              </button>
            </div>



            {ledgerSubTab === 'Conflicts' && (
              /* Conflicts Resolution Panel */
              <div className="space-y-6 animate-fade-in">
                {conflictData.length === 0 ? (
                  <div className="bg-white dark:bg-zinc-900 p-12 text-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col items-center justify-center gap-3">
                    <CheckCircle2 size={36} className="text-emerald-500" strokeWidth={1.5}/>
                    <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm">Perfect Historical Consistency!</h3>
                    <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-sm">No conflicting category assignments were found. Every unique merchant is cleanly mapped to exactly one category in your history.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6">
                    {conflictData.map((conflict, idx) => (
                      <div key={idx} className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-zinc-800 overflow-hidden hover:border-slate-300 dark:hover:border-zinc-700 transition-all">
                        {/* Header */}
                        <div className="px-6 py-4 bg-slate-50/80 dark:bg-zinc-900/50 border-b border-slate-200/60 dark:border-zinc-800 flex justify-between items-center">
                          <div>
                            <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm font-mono">{conflict.merchant}</h3>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium mt-0.5">This merchant matches multiple categories in your history. Resolve it now.</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleAllowMultiCategory(conflict.merchant)}
                              className="bg-sky-50 hover:bg-sky-100 text-sky-600 text-[10px] font-bold py-1.5 px-3 rounded-lg border border-sky-200 transition-colors"
                            >
                              Allow Multi-Category
                            </button>
                            <span className="bg-rose-50 text-rose-600 text-[10px] font-bold py-1.5 px-3 rounded-full border border-rose-100">Category Conflict</span>
                          </div>
                        </div>

                        {/* Distribution Details */}
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div>
                            <h4 className="font-bold text-xs text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Historical Assignments:</h4>
                            <div className="flex flex-col gap-2">
                              {conflict.distribution.map((dist, dIdx) => (
                                <div key={dIdx} className="flex items-center justify-between bg-slate-50 dark:bg-zinc-900/40 p-2.5 rounded-lg border border-slate-200/40 dark:border-zinc-800">
                                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{dist.category}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-slate-400 dark:text-zinc-500 text-xs font-medium">{dist.count} transaction(s)</span>
                                    <button
                                      onClick={() => handleResolveConflict(conflict.merchant, dist.category)}
                                      className="bg-sky-50 hover:bg-sky-600 text-sky-600 hover:text-white text-[10px] font-bold py-1 px-2.5 rounded-md border border-sky-100/50 transition-colors"
                                    >
                                      Force All to {dist.category}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Historical Samples */}
                          <div>
                            <h4 className="font-bold text-xs text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-3">Recent Conflict Samples:</h4>
                            <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                              {conflict.transactions.map((tx, tIdx) => (
                                <div key={tIdx} className="flex justify-between items-center text-[10px] font-semibold bg-red-50/10 dark:bg-zinc-900/40 p-2 rounded-lg border border-slate-100 dark:border-zinc-800">
                                  <div className="flex flex-col">
                                    <span className="text-slate-500 dark:text-zinc-400 font-mono">{tx.Date} - {tx.Description}</span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-slate-700 dark:text-zinc-200">${Math.abs(tx.Amount).toFixed(2)}</span>
                                    <span className="bg-slate-100 text-slate-600 dark:text-zinc-300 font-bold px-1.5 py-0.5 rounded text-[10px]">{tx.Category}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {ledgerSubTab === 'Audit' && (
              /* Categorized History Audit Panel */
              <div className="space-y-6 animate-fade-in">
                {/* Search and Title Header */}
                <div className="panel p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="space-y-1 w-full md:w-auto">
                    <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-base">Categorized History & Audit</h3>
                    <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium">Search, filter, and change categories of any previously confirmed transactions.</p>
                  </div>
                  
                  {/* Search input */}
                  <div className="relative w-full md:w-80">
                    <input 
                      type="text" 
                      placeholder="Search details or categories..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none w-full focus:bg-white dark:focus:bg-zinc-800 focus:border-sky-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Table list */}
                <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-zinc-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-zinc-900/50 text-slate-500 dark:text-zinc-400 text-xs font-bold uppercase tracking-wider border-b border-slate-200 dark:border-zinc-800">
                        <th className="p-4 pl-6">Date</th>
                        <th className="p-4">Merchant / Details</th>
                        <th className="p-4">Identity (Account / Person)</th>
                        <th className="p-4">Assigned Category</th>
                        <th className="p-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                      {isLoadingCategorized ? (
                        <tr>
                          <td colSpan="5" className="p-12 text-center text-slate-400 dark:text-zinc-500 italic">
                            <RefreshCw size={18} className="animate-spin inline mr-2 text-sky-500" strokeWidth={1.5}/>
                            Loading historical transactions...
                          </td>
                        </tr>
                      ) : categorizedData.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="p-12 text-center text-slate-400 dark:text-zinc-500 italic">
                            No matching categorized transactions found in history.
                          </td>
                        </tr>
                      ) : categorizedData.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 dark:border-zinc-800 hover:bg-slate-50/50 dark:bg-zinc-800/20 transition-colors">
                          <td className="p-4 pl-6 font-bold">{row.date}</td>
                          <td className="p-4 font-mono text-[11px] text-slate-600 dark:text-zinc-300 max-w-xs truncate" title={row.details}>
                            {row.details}
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 py-0.5 px-2 rounded-md font-mono text-[10px] w-max font-bold">
                                <CreditCard size={9} strokeWidth={1.5}/>
                                {row.account}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-bold">Profile: {row.person}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <select 
                              className="bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 outline-none focus:border-sky-500 font-semibold cursor-pointer text-xs text-slate-700 dark:text-zinc-200" 
                              value={row.category} 
                              onChange={(e) => handleRecategorize(row.id, e.target.value)} 
                            >
                              {row.category && !['Income', 'Expense', 'Savings', 'Transfer'].some(t => categories[t]?.includes(row.category)) && row.category !== 'Uncategorized' && (
                                <option value={row.category}>{row.category} (Legacy)</option>
                              )}
                              <optgroup label="Income">{categories.Income.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                              <optgroup label="Expenses">{categories.Expense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                              <optgroup label="Savings">{categories.Savings.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                            </select>
                          </td>
                          <td className={`p-4 text-right font-black ${row.type === 'Income' ? 'text-emerald-600' : 'text-slate-800 dark:text-zinc-100'}`}>
                            {row.type === 'Income' ? '+' : '-'}${Math.abs(row.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Duplicate review — exact repeats that slipped past import dedup */}
            {ledgerSubTab === 'Duplicates' && (
              <div className="space-y-6 animate-fade-in">
                <div className="panel p-6">
                  <div className="flex flex-wrap justify-between items-center gap-3 mb-5 border-b border-slate-100 dark:border-zinc-800 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-md flex-shrink-0">
                        <Copy size={18} strokeWidth={1.5} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-base leading-tight">Duplicate Transactions</h3>
                        <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium">Exact repeats — same date, description &amp; amount — that slipped past import dedup. Nothing is deleted until you confirm.</p>
                      </div>
                    </div>
                    <button
                      onClick={fetchDuplicates}
                      disabled={isScanningDups}
                      className={`flex items-center gap-2 font-bold py-2 px-4 rounded-lg border text-xs transition-all ${
                        isScanningDups
                          ? 'bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500 border-slate-200 dark:border-zinc-700 cursor-not-allowed'
                          : 'bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 border-slate-200/60 dark:border-zinc-700'
                      }`}
                    >
                      {isScanningDups ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <RefreshCw size={14} strokeWidth={1.5}/>}
                      <span>Re-scan</span>
                    </button>
                  </div>

                  {isScanningDups && !dupScanned ? (
                    <div className="text-center py-10 text-slate-400 dark:text-zinc-500">
                      <RefreshCw size={28} className="mx-auto mb-3 animate-spin" strokeWidth={1.5}/>
                      <p className="text-xs font-bold">Scanning for duplicates…</p>
                    </div>
                  ) : dupGroups.length === 0 ? (
                    <div className="text-center py-10 text-emerald-500 border-2 border-dashed border-emerald-200 dark:border-emerald-900/40 rounded-xl">
                      <CheckCircle2 size={32} className="mx-auto mb-3" strokeWidth={1.5}/>
                      <h4 className="font-bold text-sm text-slate-700 dark:text-zinc-200">No exact duplicates found</h4>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5">Your ledger looks clean — no repeat charges detected.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-zinc-300">
                          <Layers size={14} strokeWidth={1.5} className="text-amber-600"/>
                          {dupSummary?.groups ?? dupGroups.length} exact duplicate group{(dupSummary?.groups ?? dupGroups.length) !== 1 ? 's' : ''} · {dupSummary?.removable ?? 0} removable row{(dupSummary?.removable ?? 0) !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={handleRemoveDuplicates}
                          disabled={isRemovingDups || selectedDupCount === 0}
                          className={`flex items-center gap-2 font-bold py-2 px-4 rounded-lg text-xs transition-all shadow-sm ${
                            isRemovingDups || selectedDupCount === 0
                              ? 'bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed'
                              : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
                          }`}
                        >
                          {isRemovingDups ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <Trash2 size={14} strokeWidth={1.5}/>}
                          <span>Remove {selectedDupCount} selected</span>
                        </button>
                      </div>

                      {dupGroups.map((g, gi) => (
                        <div key={`${g.keep_id}-${gi}`} className="border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-zinc-800/40 border-b border-slate-100 dark:border-zinc-800">
                            <span className="text-[10px] font-black uppercase tracking-wide py-0.5 px-2 rounded border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50">Exact match</span>
                            <span className="font-mono text-xs text-slate-700 dark:text-zinc-200 truncate max-w-[280px]" title={g.merchant}>{g.merchant}</span>
                            <span className="text-xs text-slate-400 dark:text-zinc-500">{g.date}</span>
                            <span className={`text-xs font-bold ml-auto ${g.amount < 0 ? 'text-slate-700 dark:text-zinc-200' : 'text-emerald-600'}`}>
                              {g.amount < 0 ? '-' : '+'}${Math.abs(g.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 capitalize">{g.person?.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="divide-y divide-slate-50 dark:divide-zinc-800/60">
                            {g.transactions.map((t) => {
                              const isKeep = t.id === g.keep_id;
                              const marked = !!dupSelected[t.id];
                              return (
                                <label
                                  key={t.id}
                                  className={`flex items-center gap-3 px-4 py-2.5 text-xs transition-colors ${
                                    isKeep ? 'opacity-60 cursor-default' : 'cursor-pointer hover:bg-rose-50/40 dark:hover:bg-rose-950/10'
                                  } ${marked ? 'bg-rose-50/50 dark:bg-rose-950/10' : ''}`}
                                >
                                  {isKeep ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded py-0.5 px-1.5 flex-shrink-0">
                                      <CheckCircle size={10} strokeWidth={2}/> Keep
                                    </span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={marked}
                                      onChange={() => toggleDupSelection(t.id)}
                                      className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 flex-shrink-0 accent-rose-600"
                                    />
                                  )}
                                  <span className="font-mono text-slate-600 dark:text-zinc-300 truncate flex-1">{t.description}</span>
                                  <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 whitespace-nowrap">{t.category}</span>
                                  <span className="text-[10px] text-slate-400 dark:text-zinc-600 whitespace-nowrap hidden sm:inline">{t.account}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {ledgerSubTab === 'Wizard' && (
              <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
                {wizardCategories.length === 0 ? (
                  <div className="bg-white dark:bg-zinc-900 p-12 text-center rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col items-center justify-center gap-3">
                    <CheckCircle2 size={36} className="text-emerald-500" strokeWidth={1.5}/>
                    <h3 className="font-bold text-slate-800 dark:text-zinc-100 text-sm">All Category Groups Verified!</h3>
                    <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-sm">No uncategorized transactions are left. Your financial ledger is fully categorized and clean!</p>
                  </div>
                ) : (
                  (() => {
                    const activeWizardCat = wizardCategories[wizardIndex] || wizardCategories[0] || '';
                    const activeWizardTxs = groupedCategories[activeWizardCat] || [];
                    const progressPercentage = Math.round(((wizardIndex + 1) / wizardCategories.length) * 100);
                    
                    return (
                      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200/80 dark:border-zinc-800 overflow-hidden">
                        {/* Header with gradient and progress */}
                        <div className="bg-gradient-to-r from-sky-900 to-slate-900 p-6 text-white relative">
                          <div className="flex justify-between items-center mb-4">
                            <div>
                              <span className="bg-sky-500/30 text-sky-200 border border-sky-500/20 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                                Wizard Review Mode
                              </span>
                              <h3 className="font-extrabold text-lg mt-2 tracking-tight">
                                Review Group: <span className="text-amber-400 font-mono">
                                  {activeWizardCat === 'Uncategorized' ? 'Manual / Unassigned' : activeWizardCat}
                                </span> {activeWizardCat === 'Uncategorized' ? '' : 'Suggestions'}
                              </h3>
                            </div>
                            <div className="text-right">
                              <span className="text-xs font-bold text-slate-300">
                                Category Group {Math.min(wizardIndex + 1, wizardCategories.length)} of {wizardCategories.length}
                              </span>
                              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-semibold mt-0.5">{activeWizardTxs.length} transaction(s) inside</p>
                            </div>
                          </div>
                          
                          {/* Progress bar */}
                          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-sky-50 h-full transition-all duration-500" 
                              style={{ width: `${progressPercentage}%` }}
                            />
                          </div>
                        </div>

                        {/* Master Category Selector */}
                        <div className="bg-sky-50/40 dark:bg-zinc-900/50 border-b border-slate-200/60 dark:border-zinc-800 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-3">
                          <div className="flex items-center gap-2">
                            <ListFilter size={15} className="text-sky-600" strokeWidth={1.5}/>
                            <span className="text-xs font-bold text-slate-600 dark:text-zinc-300 uppercase tracking-wider">Group Actions</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-zinc-400 font-semibold">Change entire group to:</span>
                            <select
                              className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none cursor-pointer hover:border-sky-400 dark:hover:border-sky-500 transition-colors"
                              value={masterCategoryVal}
                              onChange={(e) => {
                                const selectedCat = e.target.value;
                                setMasterCategoryVal(selectedCat);
                                if (selectedCat) {
                                  // Update overrides for all transactions in this group
                                  activeWizardTxs.forEach(tx => {
                                    setWizardOverrides(prev => ({ ...prev, [tx.id]: selectedCat }));
                                  });
                                }
                              }}
                            >
                              <option value="">Select Category...</option>
                              <optgroup label="Income">{categories.Income.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                              <optgroup label="Expenses">{categories.Expense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                              <optgroup label="Savings">{categories.Savings.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                            </select>
                          </div>
                        </div>

                        {/* Transactions scrollable list */}
                        <div className="p-6 space-y-4 max-h-[380px] overflow-y-auto bg-slate-50/50 dark:bg-zinc-800/20">
                          {activeWizardTxs.map((row) => {
                            const isDismissing = dismissingRow === row.id;
                            const currentCat = wizardOverrides[row.id] || row.category || activeWizardCat;
                            
                            return (
                              <div 
                                key={row.id} 
                                className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 hover:border-sky-200 dark:hover:border-sky-500/30 shadow-sm ${
                                  isDismissing ? 'opacity-50 pointer-events-none' : ''
                                }`}
                              >
                                {/* Info Column */}
                                <div className="space-y-1.5 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 text-[10px] font-extrabold px-2 py-0.5 rounded-md font-mono border border-slate-200/20 dark:border-zinc-700/30">
                                      {row.date}
                                    </span>
                                    {/* Money direction — critical for transfers/ambiguous items */}
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                      row.amount >= 0
                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100/40 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                                        : 'bg-rose-50 text-rose-600 border-rose-100/40 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30'
                                    }`}>
                                      {row.amount >= 0 ? '↓ Money in' : '↑ Money out'}
                                    </span>
                                    {row.confidence > 0 && activeWizardCat !== 'Uncategorized' && (
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                        row.confidence >= 0.85 ? 'bg-emerald-50 text-emerald-600 border-emerald-100/40 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' :
                                        row.confidence >= 0.6 ? 'bg-amber-50 text-amber-600 border-amber-100/40 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30' :
                                        'bg-slate-50 text-slate-500 dark:text-zinc-400 border-slate-200/40 dark:bg-zinc-800 dark:border-zinc-700'
                                      }`}>
                                        AI Suggested ({Math.round(row.confidence * 100)}%)
                                      </span>
                                    )}
                                    {activeWizardCat === 'Uncategorized' && (
                                      <span className="bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-100/50 dark:border-amber-900/30">
                                        Requires Assignment
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="font-mono text-xs text-slate-700 dark:text-zinc-200 font-bold max-w-md truncate" title={row.details}>
                                    {row.details}
                                  </h4>
                                  {/* Context: which bank/account + whose profile, to aid categorization */}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {row.account && (
                                      <span className="inline-flex items-center gap-1 bg-sky-50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300 text-[10px] font-bold px-2 py-0.5 rounded-md border border-sky-100/60 dark:border-sky-900/30" title="Source account / bank">
                                        <Building2 size={10} strokeWidth={2} />
                                        {row.account}
                                      </span>
                                    )}
                                    {row.person && (
                                      <span className="inline-flex items-center gap-1 bg-slate-50 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-200/50 dark:border-zinc-700 capitalize" title="Profile">
                                        {String(row.person).replace(/_/g, ' ')}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Actions Column */}
                                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                                  <span className="font-black text-xs text-slate-800 dark:text-zinc-100 mr-2">
                                    ${Math.abs(row.amount).toFixed(2)}
                                  </span>

                                  {/* Verification controls */}
                                  <div className="flex items-center gap-2">
                                    {activeWizardCat === 'Uncategorized' ? (
                                      <select
                                        className="bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 outline-none text-xs font-semibold text-slate-700 dark:text-zinc-200 cursor-pointer focus:border-sky-500"
                                        value={wizardOverrides[row.id] || "Uncategorized"}
                                        onChange={(e) => {
                                          const newCat = e.target.value;
                                          const targetMerchant = extractCoreMerchant(row.details);
                                          const newOverrides = { ...wizardOverrides };
                                          newOverrides[row.id] = newCat;
                                          activeWizardTxs.forEach(tx => {
                                            if (extractCoreMerchant(tx.details) === targetMerchant) {
                                              newOverrides[tx.id] = newCat;
                                            }
                                          });
                                          setWizardOverrides(newOverrides);
                                        }}
                                      >
                                        <option value="Uncategorized">Select Category...</option>
                                        <optgroup label="Income">{categories.Income.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                                        <optgroup label="Expenses">{categories.Expense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                                        <optgroup label="Savings">{categories.Savings.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                                      </select>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        {/* Dropdown override selection */}
                                        <select
                                          className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2 py-1 outline-none text-[10px] font-bold text-slate-600 dark:text-zinc-300 focus:border-sky-500 cursor-pointer"
                                          value={currentCat}
                                          onChange={(e) => {
                                            const newCat = e.target.value;
                                            const targetMerchant = extractCoreMerchant(row.details);
                                            const newOverrides = { ...wizardOverrides };
                                            newOverrides[row.id] = newCat;
                                            activeWizardTxs.forEach(tx => {
                                              if (extractCoreMerchant(tx.details) === targetMerchant) {
                                                newOverrides[tx.id] = newCat;
                                              }
                                            });
                                            setWizardOverrides(newOverrides);
                                          }}
                                        >
                                          <option value={activeWizardCat}>Match: {activeWizardCat}</option>
                                          <optgroup label="Income">{categories.Income.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                                          <optgroup label="Expenses">{categories.Expense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                                          <optgroup label="Savings">{categories.Savings.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                                        </select>
                                        
                                        <button
                                          onClick={() => handleDismissWizardRow(row.id, activeWizardCat)}
                                          disabled={isDismissing}
                                          className="bg-slate-50 dark:bg-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-lg border border-slate-200/60 dark:border-zinc-700 transition-colors flex items-center justify-center cursor-pointer"
                                          title="Not in this group? Dismiss to find next best category guess"
                                        >
                                          {isDismissing ? <RefreshCw size={12} className="animate-spin" strokeWidth={1.5}/> : <X size={12} strokeWidth={1.5}/>}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Bottom Actions Footer */}
                        <div className="p-6 bg-slate-50 dark:bg-zinc-900/50 border-t border-slate-200 dark:border-zinc-800 flex justify-between items-center gap-4 flex-wrap">
                          <div className="flex gap-2">
                            {wizardIndex > 0 && (
                              <button
                                onClick={() => setWizardIndex(prev => prev - 1)}
                                className="bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center gap-2 transition-colors"
                              >
                                Previous Group
                              </button>
                            )}
                            {wizardIndex < wizardCategories.length - 1 && (
                              <button
                                onClick={() => {
                                  setWizardIndex(prev => prev + 1);
                                  setWizardOverrides({});
                                }}
                                className="bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center gap-2 transition-colors"
                              >
                                Skip Group
                              </button>
                            )}
                          </div>

                          <button
                            onClick={() => handleWizardConfirm(activeWizardCat, activeWizardTxs)}
                            disabled={isConfirmingAll || activeWizardTxs.length === 0}
                            className="btn-shine bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-700 hover:to-sky-700 text-white font-extrabold text-xs py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-md shadow-sky-100"
                          >
                            {isConfirmingAll ? <RefreshCw size={14} className="animate-spin" strokeWidth={1.5}/> : <CheckCircle2 size={14} strokeWidth={1.5}/>}
                            <span>
                              {activeWizardCat === 'Uncategorized'
                                ? `Confirm & Sweep ${activeWizardTxs.filter(t => wizardOverrides[t.id] && wizardOverrides[t.id] !== 'Uncategorized').length} Manual Assignments`
                                : `Confirm & Sweep ${activeWizardTxs.length} Group Verified`
                              }
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </div>
        )}

        {/* === SMART RULES TAB === */}
        {activeTab === 'AI Ledger' && ledgerSubTab === 'Rules' && (() => {
          const OP_LABELS = {
            any: 'Any amount',
            positive: 'Money in (+)',
            negative: 'Money out (−)',
            gte: 'Amount ≥',
            lte: 'Amount ≤',
          };
          const opSentence = (r) => {
            if (r.amount_op === 'positive') return 'is money in (+)';
            if (r.amount_op === 'negative') return 'is money out (−)';
            if (r.amount_op === 'gte') return `amount ≥ $${Number(r.amount_value || 0).toLocaleString()}`;
            if (r.amount_op === 'lte') return `amount ≤ $${Number(r.amount_value || 0).toLocaleString()}`;
            return 'any amount';
          };
          // Estimate how many transactions the in-progress rule would match
          const previewCount = (() => {
            const s = ruleSearchResults.summary;
            if (newRule.amount_op === 'positive') return s.positive;
            if (newRule.amount_op === 'negative') return s.negative;
            if (newRule.amount_op === 'gte' || newRule.amount_op === 'lte') {
              const v = parseFloat(newRule.amount_value || 0);
              return ruleSearchResults.matches.filter(m =>
                newRule.amount_op === 'gte' ? Math.abs(m.amount) >= v : Math.abs(m.amount) <= v
              ).length;
            }
            return s.total;
          })();
          const sum = ruleSearchResults.summary;

          return (
          <div className="space-y-6 animate-fade-in">
            {/* Slim toolbar — the sub-tab label is the title, so no full hero needed */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium">
                Search a keyword, then teach the bot to split it by amount or date — e.g. <span className="font-mono text-sky-500 dark:text-sky-400">VENMO</span> money-in → Income, money-out → Dining.
              </p>
              <button
                onClick={handleApplyAllRules}
                className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 font-bold py-2 px-3.5 rounded-lg text-xs transition-colors border border-slate-200/60 dark:border-zinc-700 flex-shrink-0"
              >
                <RefreshCw size={14} strokeWidth={1.5} /> Re-apply All Rules
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
              {/* LEFT: Search & discover */}
              <div className="lg:col-span-3 panel p-6 flex flex-col">
                <div className="relative mb-4">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" strokeWidth={2} />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search a merchant or keyword (e.g. VENMO, ZELLE, AMAZON)…"
                    value={ruleSearch}
                    onChange={(e) => { setRuleSearch(e.target.value); setNewRule(prev => ({ ...prev, keyword: e.target.value })); }}
                    className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-sm font-semibold text-slate-700 dark:text-zinc-200 outline-none focus:bg-white dark:focus:bg-zinc-800 focus:border-sky-500 transition-colors"
                  />
                </div>

                {!ruleSearch.trim() ? (
                  <div className="flex flex-col items-center justify-center text-center py-16 text-slate-400 dark:text-zinc-500">
                    <Search size={28} strokeWidth={1.5} className="text-slate-300 dark:text-zinc-600 mb-3" />
                    <h4 className="text-sm font-bold text-slate-600 dark:text-zinc-300">Find transactions to build a rule</h4>
                    <p className="text-[11px] font-medium max-w-xs mt-1">Type any keyword that appears in your statement descriptions to see every matching transaction.</p>
                  </div>
                ) : (
                  <>
                    {/* Summary chips */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      <span className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[11px] font-bold py-1.5 px-3 rounded-lg border border-slate-200/50 dark:border-zinc-700">
                        {isSearchingRules ? <RefreshCw size={12} className="animate-spin" /> : <ArrowDownUp size={12} strokeWidth={2} />}
                        {sum.total} match{sum.total !== 1 ? 'es' : ''}
                      </span>
                      <span className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold py-1.5 px-3 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                        <TrendingUp size={12} strokeWidth={2} /> {sum.positive} money-in
                      </span>
                      <span className="inline-flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 text-[11px] font-bold py-1.5 px-3 rounded-lg border border-rose-100 dark:border-rose-900/30">
                        <TrendingDown size={12} strokeWidth={2} /> {sum.negative} money-out
                      </span>
                      {sum.categories.map(c => (
                        <span key={c.name} className="inline-flex items-center gap-1.5 bg-sky-50/60 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 text-[11px] font-bold py-1.5 px-3 rounded-lg border border-sky-100/60 dark:border-sky-900/30">
                          {c.name} · {c.count}
                        </span>
                      ))}
                    </div>
                    {sum.positive > 0 && sum.negative > 0 && (
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 rounded-lg px-3 py-2 mb-4">
                        <Info size={13} strokeWidth={2} className="flex-shrink-0" />
                        This keyword has both money-in and money-out — a perfect candidate for two rules that split by amount.
                      </div>
                    )}

                    {/* Matches table */}
                    <div className="max-h-[420px] overflow-y-auto thin-scroll -mx-2 px-2">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm">
                          <tr className="text-slate-400 dark:text-zinc-500 text-[10px] font-black uppercase tracking-wider border-b border-slate-200/70 dark:border-zinc-800">
                            <th className="py-2.5 pr-2">Date</th>
                            <th className="py-2.5 px-2">Description</th>
                            <th className="py-2.5 px-2">Category</th>
                            <th className="py-2.5 pl-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                          {ruleSearchResults.matches.length === 0 ? (
                            <tr><td colSpan="4" className="py-10 text-center text-slate-400 dark:text-zinc-500 italic">No transactions match “{ruleSearch}”.</td></tr>
                          ) : ruleSearchResults.matches.map(m => (
                            <tr key={m.id} className="border-b border-slate-100 dark:border-zinc-800/70 hover:bg-slate-50/70 dark:hover:bg-zinc-800/40 transition-colors">
                              <td className="py-2.5 pr-2 font-mono text-[10px] text-slate-400 dark:text-zinc-500 whitespace-nowrap">{m.date}</td>
                              <td className="py-2.5 px-2 font-mono text-[10px] text-slate-600 dark:text-zinc-300 max-w-[260px] truncate" title={m.description}>{m.description}</td>
                              <td className="py-2.5 px-2">
                                <span className="inline-block bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 py-0.5 px-2 rounded text-[10px] font-bold uppercase tracking-wide">{m.category}</span>
                              </td>
                              <td className={`py-2.5 pl-2 text-right font-black tnum whitespace-nowrap ${m.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-zinc-200'}`}>
                                {m.amount > 0 ? '+' : '−'}${Math.abs(m.amount).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              {/* RIGHT: Rule builder */}
              <div className="lg:col-span-2 panel p-6 flex flex-col gap-4 self-start">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={15} className="text-sky-600 dark:text-sky-400" strokeWidth={2} />
                  <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Build a Rule</h3>
                </div>

                {/* Keyword */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">When description contains</label>
                  <input
                    type="text"
                    placeholder="keyword…"
                    value={newRule.keyword}
                    onChange={(e) => { setNewRule(prev => ({ ...prev, keyword: e.target.value })); setRuleSearch(e.target.value); }}
                    className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono font-bold text-slate-700 dark:text-zinc-200 outline-none focus:bg-white dark:focus:bg-zinc-800 focus:border-sky-500"
                  />
                </div>

                {/* Amount condition */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">And the amount</label>
                  <div className="flex gap-2">
                    <select
                      value={newRule.amount_op}
                      onChange={(e) => setNewRule(prev => ({ ...prev, amount_op: e.target.value }))}
                      className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
                    >
                      {Object.entries(OP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    {(newRule.amount_op === 'gte' || newRule.amount_op === 'lte') && (
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 text-xs font-bold">$</span>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={newRule.amount_value}
                          onChange={(e) => setNewRule(prev => ({ ...prev, amount_value: e.target.value }))}
                          className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg pl-6 pr-2 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Date range (optional) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Within dates <span className="text-slate-300 dark:text-zinc-600 normal-case font-bold">(optional)</span></label>
                  <div className="flex items-center gap-2">
                    <input type="date" value={newRule.date_start} onChange={(e) => setNewRule(prev => ({ ...prev, date_start: e.target.value }))}
                      className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 text-[11px] font-bold text-slate-600 dark:text-zinc-300 outline-none focus:border-sky-500 cursor-pointer" />
                    <span className="text-slate-400 dark:text-zinc-600 text-xs">→</span>
                    <input type="date" value={newRule.date_end} onChange={(e) => setNewRule(prev => ({ ...prev, date_end: e.target.value }))}
                      className="flex-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 text-[11px] font-bold text-slate-600 dark:text-zinc-300 outline-none focus:border-sky-500 cursor-pointer" />
                  </div>
                </div>

                {/* Category */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Assign category</label>
                  <select
                    value={newRule.category}
                    onChange={(e) => setNewRule(prev => ({ ...prev, category: e.target.value }))}
                    className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="">Select category…</option>
                    <optgroup label="Income">{categories.Income.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                    <optgroup label="Expenses">{categories.Expense.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                    <optgroup label="Savings">{categories.Savings.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                  </select>
                </div>

                {newRule.keyword.trim() && (
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-900/50 border border-slate-200/60 dark:border-zinc-800 rounded-lg px-3 py-2.5 leading-relaxed">
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{newRule.keyword.trim()}</span>
                    {' '}where <span className="font-bold">{OP_LABELS[newRule.amount_op].toLowerCase()}{(newRule.amount_op === 'gte' || newRule.amount_op === 'lte') ? ` $${newRule.amount_value || 0}` : ''}</span>
                    {' → '}<span className="font-bold text-slate-700 dark:text-zinc-200">{newRule.category || '…'}</span>
                    {ruleSearch.trim() === newRule.keyword.trim() && (
                      <span className="block mt-1 text-[10px] font-bold text-slate-400 dark:text-zinc-500">≈ {previewCount} transaction{previewCount !== 1 ? 's' : ''} affected</span>
                    )}
                  </div>
                )}

                <button
                  onClick={handleCreateRule}
                  disabled={isSavingRule || !newRule.keyword.trim() || !newRule.category}
                  className="w-full bg-gradient-to-r from-sky-600 to-sky-600 hover:from-sky-700 hover:to-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-sky-500/20"
                >
                  {isSavingRule ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={2.5} />}
                  Create &amp; Apply Rule
                </button>
              </div>
            </div>

            {/* Existing rules */}
            <div className="panel p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                  <ListFilter size={15} className="text-sky-500" strokeWidth={2} /> Active Rules
                  <span className="text-[10px] font-black bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 py-0.5 px-2 rounded-full">{smartRules.length}</span>
                </h3>
              </div>
              {smartRules.length === 0 ? (
                <div className="text-center py-10 text-slate-400 dark:text-zinc-500 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-xl">
                  <Wand2 size={24} strokeWidth={1.5} className="mx-auto mb-2 text-slate-300 dark:text-zinc-600" />
                  <p className="text-xs font-bold text-slate-600 dark:text-zinc-300">No smart rules yet</p>
                  <p className="text-[11px] font-medium mt-0.5">Search a keyword above and create your first conditional rule.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {smartRules.map(r => (
                    <div key={r.id} className="bg-slate-50 dark:bg-zinc-900/40 border border-slate-200/70 dark:border-zinc-800 rounded-xl p-4 flex items-start justify-between gap-3 hover:border-sky-300/60 dark:hover:border-sky-700/50 transition-colors">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-600 dark:text-zinc-300 leading-relaxed">
                          When <span className="font-mono font-black text-sky-600 dark:text-sky-400">{r.keyword}</span>
                          {' '}and <span className="font-bold text-slate-700 dark:text-zinc-200">{opSentence(r)}</span>
                          {(r.date_start || r.date_end) && (
                            <span className="text-slate-500 dark:text-zinc-400"> {r.date_start ? `from ${r.date_start}` : ''}{r.date_end ? ` to ${r.date_end}` : ''}</span>
                          )}
                          <span className="text-slate-400 dark:text-zinc-500"> → </span>
                          <span className="font-black text-slate-800 dark:text-zinc-100 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-1.5 py-0.5 rounded">{r.category}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500">{r.match_count} transaction{r.match_count !== 1 ? 's' : ''} match</span>
                          {r.person && r.person !== 'All Users' && (
                            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded uppercase tracking-wide">{r.person}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteRule(r.id)}
                        className="p-2 text-slate-400 dark:text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors flex-shrink-0"
                        title="Delete rule"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* === SETTINGS CONFIGURATION === */}
        {activeTab === 'Settings' && (
          <div className="space-y-6 animate-fade-in">
            {/* Hero header */}
            <div className="panel p-6 flex items-center gap-3 overflow-hidden relative">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-slate-400 via-sky-500 to-sky-500 opacity-70" />
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 dark:from-zinc-700 dark:to-zinc-900 text-white flex items-center justify-center shadow-md flex-shrink-0">
                <SlidersHorizontal size={20} strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-800 dark:text-zinc-100 leading-tight tracking-tight">Settings &amp; Taxonomy</h2>
                <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium">Customize categories and declare your bank accounts. Set monthly budgets from the dashboard's Active Monthly Budgets card. Renamed categories auto-migrate; deleted ones reset to Uncategorized.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {['Income', 'Expense', 'Savings'].map(type => (
                <div key={type} className="panel p-6 flex flex-col">
                  <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-zinc-800 pb-4">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 uppercase tracking-wider flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${
                          type === 'Income' ? 'bg-emerald-500' :
                          type === 'Expense' ? 'bg-rose-500' :
                          'bg-sky-500'
                        }`} />
                        {type} Rules
                    </h3>
                  </div>

                  {/* Add category field */}
                  <div className="flex gap-2 mb-4">
                    <input 
                      type="text"
                      placeholder={`New ${type} Category...`}
                      value={newCatName[type]}
                      onChange={(e) => setNewCatName(prev => ({ ...prev, [type]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          addCategory(type, newCatName[type]);
                          setNewCatName(prev => ({ ...prev, [type]: "" }));
                        }
                      }}
                      className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 outline-none flex-1 focus:bg-white dark:focus:bg-zinc-800 focus:border-sky-500"
                    />
                    <button 
                      onClick={() => {
                        addCategory(type, newCatName[type]);
                        setNewCatName(prev => ({ ...prev, [type]: "" }));
                      }}
                      className="bg-slate-100 hover:bg-sky-600 hover:text-white p-2 rounded-lg transition-colors text-slate-600 dark:text-zinc-300"
                    >
                      <Plus size={16} strokeWidth={1.5}/>
                    </button>
                  </div>
                  
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {categories[type].map((cat, index) => (
                      <div key={index} className="flex justify-between items-center bg-slate-50 dark:bg-zinc-900/40 p-2.5 rounded-lg border border-slate-200/40 dark:border-zinc-800 group">
                        <div className="flex flex-col gap-1 flex-1">
                          <span className="font-bold text-xs text-slate-700 dark:text-zinc-200">{cat}</span>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            {cat !== 'Uncategorized' && (
                              <button 
                                onClick={() => deleteCategory(type, cat)}
                                className="p-1 text-slate-400 dark:text-zinc-500 hover:bg-slate-200 hover:text-rose-600 rounded transition-colors"
                              >
                                <Trash2 size={12} strokeWidth={1.5}/>
                              </button>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* === BANK SLOT DECLARATIONS === */}
            <div className="bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-sm border border-slate-200/80 dark:border-zinc-800 mt-8">
              <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-zinc-800 pb-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 dark:text-zinc-100 uppercase tracking-wider flex items-center gap-2">
                    <CreditCard size={18} className="text-sky-500" strokeWidth={1.5}/>
                    Declared Bank Cards & Ingestion Slots
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 font-medium mt-1">
                    Declare your active bank accounts and credit cards to instantiate automated ingestion slots.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Form to declare bank card */}
                <div className="bg-slate-50/50 dark:bg-zinc-800/20 p-6 rounded-xl border border-slate-200/60 dark:border-zinc-700 space-y-4">
                  <h4 className="font-extrabold text-xs text-slate-700 dark:text-zinc-200 uppercase tracking-wider">Declare New Account Slot</h4>
                  
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wide">Account Slot Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Chase Sapphire, Amex Gold"
                        value={newBankForm.name}
                        onChange={(e) => setNewBankForm(prev => ({ ...prev, name: e.target.value }))}
                        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wide">Account Type</label>
                      <select
                        value={newBankForm.type}
                        onChange={(e) => setNewBankForm(prev => ({ ...prev, type: e.target.value }))}
                        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500"
                      >
                        <option value="Banking">Banking (Checking/Savings)</option>
                        <option value="Credit Card">Credit Card</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wide">Default Owner Profile</label>
                      <select
                        value={newBankForm.owner}
                        onChange={(e) => setNewBankForm(prev => ({ ...prev, owner: e.target.value }))}
                        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 outline-none focus:border-sky-500"
                      >
                        <option value="big_boo">big_boo</option>
                        <option value="lil_boo">lil_boo</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (!newBankForm.name.trim()) {
                        notify("Please enter a valid card or account name first.", 'error');
                        return;
                      }
                      if (settings.declared_banks.some(b => b.name.toLowerCase() === newBankForm.name.trim().toLowerCase())) {
                        notify("An account slot with this name already exists.", 'error');
                        return;
                      }
                      const updatedBanks = [
                        ...settings.declared_banks,
                        {
                          name: newBankForm.name.trim(),
                          type: newBankForm.type,
                          owner: newBankForm.owner
                        }
                      ];
                      handleSaveSettings({
                        ...settings,
                        declared_banks: updatedBanks
                      });
                      setNewBankForm({ name: "", type: "Banking", owner: "big_boo" });
                    }}
                    className="w-full bg-sky-600 hover:bg-sky-700 text-white font-extrabold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm"
                  >
                    Instantiate Account Slot
                  </button>
                </div>

                {/* Declared slots list */}
                <div className="lg:col-span-2 space-y-4">
                  <h4 className="font-extrabold text-xs text-slate-700 dark:text-zinc-200 uppercase tracking-wider">Active Declared Card Slots</h4>
                  
                  {settings.declared_banks.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400 dark:text-zinc-500 font-medium border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-xl">
                      No accounts declared. Add a new slot to initialize ingestion slots.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {settings.declared_banks.map((bank) => (
                        <div key={bank.name} className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl flex justify-between items-center hover:border-slate-300 dark:hover:border-zinc-700 transition-all duration-300">
                          <div className="space-y-1">
                            <h5 className="font-black text-sm text-slate-800 dark:text-zinc-100">{bank.name}</h5>
                            <div className="flex gap-1.5 flex-wrap">
                              <span className={`inline-block py-0.5 px-2 rounded text-[10px] font-black uppercase tracking-wide border ${
                                bank.type === 'Banking' 
                                  ? 'bg-sky-100 text-sky-700 border-sky-200/30 dark:bg-sky-950/35 dark:text-sky-400 dark:border-sky-900/30' 
                                  : 'bg-rose-100 text-rose-700 border-rose-200/30 dark:bg-rose-950/35 dark:text-rose-400 dark:border-rose-900/30'
                              }`}>
                                {bank.type}
                              </span>
                              <span className="inline-block bg-slate-200/80 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 py-0.5 px-2 rounded text-[10px] font-black uppercase tracking-wide border border-transparent dark:border-zinc-700/50">
                                {bank.owner}
                              </span>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => {
                              const updatedBanks = settings.declared_banks.filter(b => b.name !== bank.name);
                              handleSaveSettings({
                                ...settings,
                                declared_banks: updatedBanks
                              });
                            }}
                            className="p-2 text-slate-400 dark:text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} strokeWidth={1.5}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}