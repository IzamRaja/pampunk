import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from './firebaseConfig';
import { 
    collection, 
    addDoc, 
    updateDoc, 
    doc, 
    onSnapshot, 
    query, 
    orderBy,
    deleteDoc,
    getDocs
} from 'firebase/firestore';

// --- Types & Interfaces ---
interface Customer {
  id: string;
  name: string;
  address: string;
  phone: string;
  type: 'Umum' | 'Bisnis';
  lastMeterReading: number;
  createdAt?: number; // Penanda waktu input
}

interface Bill {
  id: string;
  customerId: string;
  month: string; // "YYYY-MM"
  prevReading: number;
  currReading: number;
  usage: number;
  amount: number;
  details: {
    beban: number;
    pakai: number;
    denda: number;
    tarifPerM3: number;
  };
  isPaid: boolean;
  dateCreated: number;
  paidDate?: number;
}

interface Transaction {
    id: string;
    type: 'in' | 'out'; // Pemasukan atau Pengeluaran
    description: string;
    amount: number;
    date: number; // Timestamp
    isManual: boolean; // True jika input manual, False jika dari tagihan air
    sourceId?: string;
}

// --- Constants & Config ---
const BIAYA_BEBAN = 7000;
const BIAYA_DENDA = 5000; 
const TANGGAL_DENDA = 10;
const TARIF_UMUM = 1500;
const TARIF_BISNIS = 3000;

// --- Helper Functions ---
const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
const getCurrentMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const getMonthName = (yearMonth: string) => {
    const [year, month] = yearMonth.split('-');
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
};

// Format number with dots (e.g. 1.000.000)
const formatNumberDots = (num: string | number) => {
    const nStr = num.toString().replace(/\D/g, '');
    if (!nStr) return '';
    return new Intl.NumberFormat('id-ID').format(Number(nStr));
};

const padMeter = (num: number | string) => {
    if (num === '' || num === null || num === undefined) return '';
    const n = Number(num);
    if (isNaN(n)) return "00000";
    return n.toString().padStart(5, '0');
};

const handleMeterInputChange = (val: string, setter: (v: string) => void) => {
    const clean = val.replace(/\D/g, '');
    if (clean === '') {
        setter('');
        return;
    }
    const num = parseInt(clean, 10);
    const formatted = num.toString().padStart(5, '0');
    setter(formatted);
};

// --- Login Component ---
const LoginView = ({ 
    onLogin, 
    installPrompt, 
    onInstall, 
    isAppInstalled 
}: { 
    onLogin: () => void, 
    installPrompt: any, 
    onInstall: () => void,
    isAppInstalled: boolean
}) => {
    const [u, setU] = useState('');
    const [p, setP] = useState('');
    const [err, setErr] = useState('');
    const [imgError, setImgError] = useState(false);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        // Simple Hardcoded Login for Admin
        if (u === 'admin' && p === 'pampunk') {
            onLogin();
        } else {
            setErr('Username atau Password salah!');
        }
    };

    return (
        <div style={{height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem'}}>
            <div className="card w-full" style={{maxWidth: '350px'}}>
                <div className="flex flex-col items-center mb-6">
                    {/* Menggunakan logo.png - User HARUS upload ini */}
                    {!imgError ? (
                        <img 
                            src="./logo.png?v=21"
                            alt="Logo Pamsimas" 
                            style={{width: '40px', height: '40px', objectFit: 'contain', marginBottom: '1rem'}}
                            onError={() => setImgError(true)}
                        />
                    ) : (
                        <div style={{fontSize: '3rem', marginBottom: '1rem', lineHeight: 1}}>💧</div>
                    )}
                    <h2 className="text-xl font-bold text-center text-primary m-0">PAMSIMAS</h2>
                    <div className="text-sm text-secondary">Pungkuran Kwangsan</div>
                </div>
                
                <form onSubmit={handleLogin} autoComplete="off">
                    <div className="input-group">
                        <label>Username</label>
                        <input className="input-field" style={{color: '#000'}} type="text" value={u} onChange={e => setU(e.target.value)} autoComplete="off" />
                    </div>
                    <div className="input-group">
                        <label>Password</label>
                        <input className="input-field" style={{color: '#000'}} type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="new-password" />
                    </div>
                    {err && <div className="text-red-600 text-sm text-center mb-3 bg-red-50 p-2 rounded">{err}</div>}
                    <button type="submit" className="btn mb-4">Masuk</button>
                    
                    {/* Hanya tampilkan tombol install jika browser benar-benar siap */}
                    {installPrompt && (
                        <div className="text-center pt-4 border-t border-gray-200 animate-fade-in mb-4">
                             <div className="text-xs text-secondary mb-2">Aplikasi tersedia untuk diinstall</div>
                             <button 
                                type="button" 
                                onClick={onInstall} 
                                className="btn btn-secondary w-full"
                                style={{borderColor: '#0288D1', color: '#0288D1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}
                            >
                                <span className="material-icons-round">install_mobile</span>
                                Install ke Layar Utama
                            </button>
                        </div>
                    )}
                </form>
            </div>
            <div className="mt-8 text-xs text-gray-400 text-center">
                &copy; 2026 Aplikasi Pamsimas Pungkuran
            </div>
        </div>
    );
};

// --- Main App Component ---
const App = () => {
  // --- State ---
  // Inisialisasi state login berdasarkan localStorage agar persisten saat refresh
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('pamsimas_auth') === 'true');
  
  const [view, setView] = useState<'dashboard' | 'customers' | 'recording' | 'bills' | 'cashbook'>('dashboard');
  const [billFilter, setBillFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [selectedCustomerForRecording, setSelectedCustomerForRecording] = useState<Customer | null>(null);
  
  // PWA State
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  
  // --- FIREBASE DATA STATE ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [manualTransactions, setManualTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // --- AUTH HANDLERS ---
  const handleLoginSuccess = () => {
      localStorage.setItem('pamsimas_auth', 'true');
      setIsLoggedIn(true);
  };

  const handleLogout = () => {
      if(confirm('Apakah Anda yakin ingin keluar dari aplikasi?')) {
          localStorage.removeItem('pamsimas_auth');
          setIsLoggedIn(false);
          setView('dashboard'); // Reset view
      }
  };

  // --- PWA INSTALL HANDLER ---
  useEffect(() => {
    // 1. Cek Mode Standalone (Sudah diinstall)
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) {
        setIsAppInstalled(true);
    }

    // 2. Event Listener untuk Install Prompt
    const handler = (e: any) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = () => {
    if (!installPrompt) return;
    // Show the install prompt
    installPrompt.prompt();
    // Wait for the user to respond to the prompt
    installPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
            setInstallPrompt(null);
        }
    });
  };

  // --- FIREBASE SUBSCRIPTIONS (REALTIME SYNC) ---
  useEffect(() => {
    // 1. Subscribe to Customers
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Customer[];
        
        // Sorting Logic: Berdasarkan waktu input (createdAt)
        data.sort((a, b) => {
            const timeA = a.createdAt || 0;
            const timeB = b.createdAt || 0;
            
            if (timeA !== timeB) {
                return timeA - timeB; // Lama ke Baru (Urutan Input)
            }
            return a.name.localeCompare(b.name);
        });
        
        setCustomers(data);
    });

    // 2. Subscribe to Bills
    const qBills = query(collection(db, 'bills'), orderBy('dateCreated', 'desc'));
    const unsubBills = onSnapshot(qBills, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Bill[];
        setBills(data);
    });

    // 3. Subscribe to Transactions
    const qTrans = query(collection(db, 'transactions'), orderBy('date', 'desc'));
    const unsubTrans = onSnapshot(qTrans, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Transaction[];
        setManualTransactions(data);
        setIsLoading(false);
    });

    return () => {
        unsubCustomers();
        unsubBills();
        unsubTrans();
    };
  }, []);

  const totalBillIncome = bills.filter(b => b.isPaid).reduce((acc, b) => acc + b.amount, 0);
  const totalManualIncome = manualTransactions.filter(t => t.type === 'in').reduce((acc, t) => acc + t.amount, 0);
  const totalManualExpense = manualTransactions.filter(t => t.type === 'out').reduce((acc, t) => acc + t.amount, 0);
  const lifetimeBalance = (totalBillIncome + totalManualIncome) - totalManualExpense;

  const DashboardView = () => {
    const [reportMonth, setReportMonth] = useState(getCurrentMonth());
    const currentMonth = getCurrentMonth();
    const monthBills = bills.filter(b => b.month === currentMonth);
    const totalCustomers = customers.length;
    
    const usageThisMonth = monthBills.reduce((acc, b) => acc + b.usage, 0);
    const totalUsageLifetime = bills.reduce((acc, b) => acc + b.usage, 0);

    const paidCount = monthBills.filter(b => b.isPaid).length;
    const unpaidCount = monthBills.filter(b => !b.isPaid).length;

    const handleDownloadReport = () => {
        // 1. Filter data based on selected month (from dashboard state)
        const billsInMonth = bills.filter(b => b.month === reportMonth);
        const transactionsInMonth = manualTransactions.filter(t => new Date(t.date).toISOString().slice(0, 7) === reportMonth);
        
        // 2. Calculate Financial Summary
        // Pemasukan: Tagihan Air Lunas + Manual Income
        const waterIncome = billsInMonth.filter(b => b.isPaid).reduce((sum, b) => sum + b.amount, 0);
        const manualIncome = transactionsInMonth.filter(t => t.type === 'in').reduce((sum, t) => sum + t.amount, 0);
        const totalIncome = waterIncome + manualIncome;
        
        // Pengeluaran: Manual Expense
        const totalExpense = transactionsInMonth.filter(t => t.type === 'out').reduce((sum, t) => sum + t.amount, 0);
        
        const balance = totalIncome - totalExpense;

        // 3. Construct CSV Content
        // Format: No;Nama;MeteranLama;MeteranBaru;JumlahTagihan;Denda;Tunggakan;Status
        
        let csvContent = "data:text/csv;charset=utf-8,";
        
        // Header Keuangan
        csvContent += `LAPORAN KEUANGAN PAMSIMAS\n`;
        csvContent += `Periode;${getMonthName(reportMonth)}\n`;
        csvContent += `Pemasukan (Air + Lainnya);${totalIncome}\n`;
        csvContent += `Pengeluaran;${totalExpense}\n`;
        csvContent += `Saldo Periode Ini;${balance}\n\n`;

        // Table Header
        csvContent += "No;Nama Pelanggan;Meteran Lama;Meteran Baru;Jumlah Tagihan;Denda;Tunggakan;Lunas/Belum\n";

        // Table Rows (Sorted by Name)
        const sortedBillsForReport = [...billsInMonth].sort((a, b) => {
             const custA = customers.find(c => c.id === a.customerId)?.name || '';
             const custB = customers.find(c => c.id === b.customerId)?.name || '';
             return custA.localeCompare(custB);
        });

        sortedBillsForReport.forEach((b, index) => {
            const cust = customers.find(c => c.id === b.customerId);
            
            // Logic Kolom
            const jumlahTagihanMurni = b.details.beban + b.details.pakai;
            const denda = b.details.denda;
            
            // Tunggakan: Jika belum lunas, maka total yang harus dibayar adalah tunggakan. Jika lunas, 0.
            const tunggakan = !b.isPaid ? (jumlahTagihanMurni + denda) : 0;
            const status = b.isPaid ? "Lunas" : "Belum Bayar";

            // Format Baris CSV
            const row = [
                index + 1,
                `"${cust?.name || 'Unknown'}"`,
                b.prevReading,
                b.currReading,
                jumlahTagihanMurni,
                denda,
                tunggakan,
                status
            ].join(";");
            
            csvContent += row + "\n";
        });

        // 4. Download Trigger
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Laporan_Pamsimas_${reportMonth}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const MenuCard = ({ title, value, icon, color, onClick, subtext }: any) => (
      <button onClick={onClick} className={`card p-4 flex flex-col items-center justify-center text-center ${onClick ? 'cursor-pointer hover:bg-gray-50 active:scale-95' : 'cursor-default'} border-0 shadow-sm h-full w-full relative overflow-hidden transition-transform transform`}>
        <div className={`absolute top-0 left-0 w-1 h-full`} style={{ backgroundColor: color }}></div>
        <div className="mb-2 p-2 rounded-full bg-opacity-10" style={{ backgroundColor: `${color}20`, color: color }}>
          <span className="material-icons-round text-2xl">{icon}</span>
        </div>
        <div className="text-xs font-bold text-secondary uppercase mb-1">{title}</div>
        <div className="text-lg font-bold text-primary mb-1">{value}</div>
        {subtext && <div className="text-xs text-secondary opacity-80">{subtext}</div>}
      </button>
    );

    return (
      <div className="animate-fade-in flex flex-col h-full">
        <h2 className="text-xl font-bold mb-6 text-primary text-center">Dashboard</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <MenuCard title="Data Pelanggan" value={totalCustomers} subtext="Orang" icon="people" color="#0288D1" onClick={() => setView('customers')} />
          <MenuCard title="Penggunaan" value={`${usageThisMonth} / ${totalUsageLifetime}`} subtext="Kubik (Bln/Tot)" icon="water_drop" color="#00BCD4" onClick={null} />
          <MenuCard title="Sudah Bayar" value={paidCount} subtext="Orang" icon="check_circle" color="#10B981" onClick={() => { setBillFilter('paid'); setView('bills'); }} />
          <MenuCard title="Belum Bayar" value={unpaidCount} subtext="Orang" icon="warning" color="#EF4444" onClick={() => { setBillFilter('unpaid'); setView('bills'); }} />
          <MenuCard title="Kas" value={formatCurrency(lifetimeBalance)} subtext="Saldo Akhir" icon="account_balance_wallet" color="#6366F1" onClick={null} />
          <MenuCard title="Input Kas" value="Transaksi" subtext="Masuk/Keluar" icon="edit_note" color="#F59E0B" onClick={() => setView('cashbook')} />
        </div>
        
        {/* Tombol Download CSV (Menggantikan Backup) */}
        <div className="mt-4 flex flex-col items-center gap-3">
             <div className="flex items-center gap-2 bg-white p-2 rounded-lg shadow-sm border border-gray-200">
                {/* Month Picker for Report */}
                <input 
                    type="month" 
                    className="text-sm border-none bg-transparent outline-none font-medium text-secondary cursor-pointer" 
                    value={reportMonth} 
                    onChange={e => setReportMonth(e.target.value)} 
                    title="Pilih Bulan Laporan"
                />
                <div className="w-px h-5 bg-gray-300 mx-1"></div>
                {/* Download Button */}
                <button 
                    onClick={handleDownloadReport}
                    className="bg-transparent border-0 flex items-center gap-1 cursor-pointer hover:opacity-80 p-1"
                    style={{color: '#10B981', fontSize: '0.85rem', fontWeight: 600}}
                >
                    <span className="material-icons-round" style={{fontSize: '1.2rem'}}>description</span>
                    <span>Download Buku Kas</span>
                </button>
             </div>

             <button 
                onClick={handleLogout}
                className="bg-transparent border-0 flex items-center gap-1 cursor-pointer hover:opacity-80 p-2"
                style={{color: '#EF4444', fontSize: '0.75rem', fontWeight: 500}}
            >
                <span className="material-icons-round" style={{fontSize: '1rem'}}>logout</span>
                <span>Log Out</span>
            </button>
        </div>
      </div>
    );
  };

  const CustomersView = () => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState(''); 
    const [custForm, setCustForm] = useState<{name: string, address: string, phone: string, initialMeter: string, type: 'Umum' | 'Bisnis'}>({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' });

    const handleSave = async () => {
        if(!custForm.name) return;
        
        try {
            if (editingId) {
                // UPDATE Firebase
                await updateDoc(doc(db, 'customers', editingId), {
                    name: custForm.name,
                    address: custForm.address,
                    phone: custForm.phone,
                    type: custForm.type,
                    lastMeterReading: Number(custForm.initialMeter) || 0
                });
            } else {
                // CREATE Firebase
                await addDoc(collection(db, 'customers'), {
                    name: custForm.name,
                    address: custForm.address,
                    phone: custForm.phone,
                    type: custForm.type,
                    lastMeterReading: Number(custForm.initialMeter) || 0,
                    createdAt: Date.now()
                });
            }
        } catch (error) {
            console.error("Error saving customer:", error);
            alert("Gagal menyimpan data. Cek koneksi internet.");
            return;
        }
        
        setIsAdding(false);
        setEditingId(null);
        setCustForm({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' });
    };

    const handleEditClick = (e: React.MouseEvent, customer: Customer) => {
        e.stopPropagation(); 
        setCustForm({
            name: customer.name,
            address: customer.address,
            phone: customer.phone,
            initialMeter: padMeter(customer.lastMeterReading),
            type: customer.type
        });
        setEditingId(customer.id);
        setIsAdding(true);
    };

    const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.address.toLowerCase().includes(searchQuery.toLowerCase()));

    if (isAdding) {
        return (
            <div>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold m-0">{editingId ? 'Edit Data Pelanggan' : 'Pelanggan Baru'}</h2>
                </div>
                <div className="card">
                    <div className="input-group">
                        <label>Nama Lengkap</label>
                        <input className="input-field" value={custForm.name} onChange={e => setCustForm({...custForm, name: e.target.value})} autoComplete="off" />
                    </div>
                    <div className="input-group">
                        <label>Alamat / Dusun</label>
                        <input className="input-field" value={custForm.address} onChange={e => setCustForm({...custForm, address: e.target.value})} autoComplete="off" />
                    </div>
                    <div className="input-group">
                        <label>Tipe Pelanggan</label>
                        <select className="input-field" value={custForm.type} onChange={e => setCustForm({...custForm, type: e.target.value as 'Umum' | 'Bisnis'})}>
                            <option value="Umum">Umum</option>
                            <option value="Bisnis">Bisnis</option>
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Nomor HP (Opsional)</label>
                        <input className="input-field" value={custForm.phone} onChange={e => setCustForm({...custForm, phone: e.target.value})} type="tel" autoComplete="off" />
                    </div>
                    <div className="input-group">
                        <label>{editingId ? 'Meteran Terakhir' : 'Meteran Awal'}</label>
                        <input className="input-field text-right font-mono" value={custForm.initialMeter} onChange={e => handleMeterInputChange(e.target.value, (v) => setCustForm({...custForm, initialMeter: v}))} onBlur={e => setCustForm({...custForm, initialMeter: padMeter(e.target.value)})} type="text" inputMode="numeric" placeholder="00000" autoComplete="off" />
                    </div>
                    <button onClick={handleSave} className="btn mt-4">{editingId ? 'Update Data' : 'Simpan Data'}</button>
                    <button onClick={() => { setIsAdding(false); setEditingId(null); setCustForm({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' }); }} className="btn btn-secondary mt-2">Batal</button>
                </div>
            </div>
        );
    }

    return (
      <div className="relative h-full">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold m-0">Data Pelanggan</h2>
            <button onClick={() => setView('dashboard')} style={{ color: '#0288D1' }} className="text-sm font-bold bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
        </div>
        <div className="mb-4">
             <input className="input-field" placeholder="Cari nama atau alamat..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoComplete="off" />
        </div>
        
        <div className="flex flex-col gap-2 pb-24">
            {filteredCustomers.length === 0 ? <div className="text-center text-secondary py-4">Tidak ditemukan data.</div> : filteredCustomers.map((c, index) => (
                    <div 
                        key={c.id} 
                        onClick={() => { setSelectedCustomerForRecording(c); setView('recording'); }} 
                        className="card m-0 cursor-pointer hover:bg-gray-50 active:scale-98 transition-transform"
                    >
                        <div className="flex justify-between items-start mb-1">
                            <div className="font-bold text-lg text-primary capitalize">{c.name}</div>
                            
                            {/* Tombol Aksi Kanan */}
                            <div className="flex flex-col items-end gap-1">
                                <span className={`text-xs font-bold mb-1 ${c.type === 'Bisnis' ? 'text-purple-700' : 'text-gray-700'}`}>{c.type}</span>
                                
                                <div className="flex gap-1 items-center" onClick={e => e.stopPropagation()}>
                                    <button 
                                        onClick={(e) => handleEditClick(e, c)} 
                                        className="text-sm font-bold bg-transparent border-0 p-0 cursor-pointer"
                                        style={{ color: '#0288D1' }}
                                    >
                                        Edit
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="text-sm text-secondary capitalize mb-1">{c.address}</div>
                        <div className="text-sm text-secondary">{c.phone || '-'}</div>
                    </div>
            ))}
        </div>
        <button onClick={() => { setIsAdding(true); setEditingId(null); setCustForm({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' }); }} className="fab" style={{ backgroundColor: '#10B981' }}><span className="material-icons-round" style={{fontSize: '28px'}}>add</span></button>
      </div>
    );
  };

  const RecordingView = () => {
    const customer = selectedCustomerForRecording;
    const [currentReading, setCurrentReading] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => { window.scrollTo(0,0); }, []);
    if (!customer) { setView('customers'); return null; }

    const prevReading = customer.lastMeterReading;
    const currReadingNum = Number(currentReading);
    const usage = currReadingNum >= prevReading ? currReadingNum - prevReading : 0;
    const tarifPerM3 = customer.type === 'Bisnis' ? TARIF_BISNIS : TARIF_UMUM;
    const biayaPakai = usage * tarifPerM3;
    
    // REVISI LOGIKA DENDA:
    // Denda tidak diterapkan saat pencatatan meter. 
    // Denda hanya diterapkan saat pembayaran (BillsView) jika melewati tanggal 10.
    const dendaAmount = 0; 
    
    const currentBillAmount = BIAYA_BEBAN + biayaPakai + dendaAmount;

    // Hitung Tunggakan (Bill sebelumnya yang belum lunas)
    const unpaidBills = bills.filter(b => b.customerId === customer.id && !b.isPaid);
    const arrearsTotal = unpaidBills.reduce((acc, b) => acc + b.amount, 0);
    const totalToPay = currentBillAmount + arrearsTotal;

    const isValid = currReadingNum >= prevReading && currentReading !== '';
    const hasPhone = customer.phone && customer.phone.trim().length > 0;

    const handleSave = async (sendWa: boolean) => {
        if (!isValid || isSaving) return;
        setIsSaving(true);

        const newBillData = {
            customerId: customer.id,
            month: getCurrentMonth(),
            prevReading: prevReading,
            currReading: currReadingNum,
            usage: usage,
            amount: currentBillAmount,
            details: { beban: BIAYA_BEBAN, pakai: biayaPakai, denda: dendaAmount, tarifPerM3: tarifPerM3 },
            isPaid: false,
            dateCreated: Date.now()
        };

        try {
            // 1. Save Bill to Firebase
            await addDoc(collection(db, 'bills'), newBillData);

            // 2. Update Customer Last Meter to Firebase
            await updateDoc(doc(db, 'customers', customer.id), {
                lastMeterReading: currReadingNum
            });

            if (sendWa && hasPhone) {
                let phoneNumber = customer.phone.replace(/\D/g, '');
                if (phoneNumber.startsWith('0')) phoneNumber = '62' + phoneNumber.slice(1);
                else if (!phoneNumber.startsWith('62') && phoneNumber.length > 5) phoneNumber = '62' + phoneNumber; 
                
                let message = `*PAMSIMAS PUNGKURAN*\n\n`;
                message += `Kepada Pelanggan, *Bpk/Ibu ${customer.name.toUpperCase()}*\n\n`;
                message += `Berikut rincian tagihan pemakaian air Anda:\n`;
                message += `* Tipe : ${customer.type}\n`;
                message += `* Periode: ${new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}\n`;
                message += `* Meteran Lama: ${padMeter(prevReading)}\n`;
                message += `* Meteran Baru: ${padMeter(currReadingNum)}\n`;
                message += `* Total Pemakaian: ${usage} m³\n\n`;

                message += `Rincian Biaya:\n`;
                message += `* Biaya Beban: ${formatCurrency(BIAYA_BEBAN)}\n`;
                message += `* Biaya Pakai: ${formatCurrency(biayaPakai)}\n`;
                message += `(${usage} m³ x ${formatCurrency(tarifPerM3)})\n\n`;
                
                if (arrearsTotal > 0 || dendaAmount > 0) {
                     if(dendaAmount > 0) message += `* Denda: ${formatCurrency(dendaAmount)}\n`;
                     if(arrearsTotal > 0) message += `* Tunggakan: ${formatCurrency(arrearsTotal)}\n`;
                     message += `\n*TOTAL TAGIHAN: ${formatCurrency(totalToPay)}*\n\n`;
                } else {
                     message += `*TOTAL TAGIHAN: ${formatCurrency(currentBillAmount)}*\n\n`;
                }

                message += `_Lakukan pembayaran sebelum tanggal 10 untuk menghindari denda._\n\n`;
                message += `_Terima kasih._`;

                window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`, '_blank');
            }
            setSelectedCustomerForRecording(null);
            setView('customers');
        } catch (err) {
            console.error(err);
            alert("Gagal menyimpan. Cek koneksi.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold m-0">Catat Meter & Tagihan</h2>
                <button onClick={() => setView('customers')} style={{ color: '#0288D1' }} className="text-sm font-bold bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
            </div>
            <div className="card bg-blue-50 border-blue-200 mb-4">
                <div className="flex justify-between items-start mb-1">
                    <div className="font-bold text-lg text-primary capitalize">{customer.name}</div>
                    <div className="flex flex-col items-end">
                        <span className={`text-xs font-bold mb-1 ${customer.type === 'Bisnis' ? 'text-purple-700' : 'text-blue-800'}`}>{customer.type}</span>
                    </div>
                </div>
                <div className="text-sm text-secondary flex items-center gap-1 mb-1"><span className="material-icons-round text-xs w-4">location_on</span>{customer.address}</div>
                <div className="text-sm text-secondary flex items-center gap-1"><span className="material-icons-round text-xs w-4">phone</span>{customer.phone || '-'}</div>
            </div>
            <div className="card">
                <div className="mb-4">
                    <label className="block text-sm text-secondary mb-1">Meteran Lama</label>
                    <div className="w-full p-2 bg-gray-100 rounded text-right font-bold text-gray-600 border border-gray-300 text-lg">{padMeter(prevReading)}</div>
                </div>
                <div className="mb-4">
                    <label className="block text-sm text-primary font-bold mb-1">Meteran Baru</label>
                    <input type="text" inputMode="numeric" className="w-full p-2 border border-primary rounded text-right font-bold text-lg outline-none focus:ring-2 ring-blue-300 bg-white" value={currentReading} onChange={(e) => handleMeterInputChange(e.target.value, setCurrentReading)} onBlur={() => setCurrentReading(padMeter(currentReading))} placeholder="00000" autoFocus autoComplete="off" />
                </div>
                <div className="mb-6">
                    <label className="block text-sm text-secondary mb-1">Penggunaan Air (m³)</label>
                    <div className="w-full p-2 bg-blue-50 rounded text-right font-bold text-primary border border-blue-200 text-lg">{usage}</div>
                </div>
                <div className="bg-gray-50 p-4 rounded border border-dashed border-gray-300 mb-6">
                    <div className="text-xs font-bold text-secondary uppercase mb-3 tracking-wider">Rincian Tagihan</div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-gray-600">Biaya Beban</span><span className="font-medium">{formatCurrency(BIAYA_BEBAN)}</span></div>
                    <div className="flex justify-between text-sm mb-2 pb-2 border-b border-gray-200"><span className="text-gray-600">Biaya Pakai&nbsp;<span className="text-xs text-gray-400">({usage} m³ x {formatCurrency(tarifPerM3)})</span></span><span className="font-medium">{formatCurrency(biayaPakai)}</span></div>
                    {/* Denda disembunyikan saat pencatatan karena belum terlambat */}
                    
                    {arrearsTotal > 0 && (
                        <div className="flex justify-between text-sm mb-2 text-red-600 pt-2 border-t border-gray-200 border-dashed">
                             <span>Tunggakan ({unpaidBills.length} bln)</span>
                             <span className="font-medium">{formatCurrency(arrearsTotal)}</span>
                        </div>
                    )}

                    <div className="flex justify-between items-center mt-2"><span className="font-bold text-lg text-gray-800">Total Tagihan</span><span className="font-bold text-xl text-primary">{formatCurrency(totalToPay)}</span></div>
                </div>
                {currReadingNum < prevReading && currentReading !== '' && <div className="text-red-500 text-sm mb-4 text-center bg-red-50 p-2 rounded">⚠️ Meteran baru tidak boleh lebih kecil dari meteran lama.</div>}
                <div className="flex flex-col gap-3">
                     <button onClick={() => handleSave(hasPhone)} disabled={!isValid || isSaving} className={`btn ${!isValid ? 'opacity-50 cursor-not-allowed' : ''}`} style={{backgroundColor: '#10B981'}}>
                        <span className="material-icons-round">{isSaving ? 'hourglass_empty' : (hasPhone ? 'send' : 'save')}</span>
                        {isSaving ? 'Menyimpan...' : (hasPhone ? 'Simpan & Kirim Tagihan' : 'Simpan Tagihan')}
                    </button>
                </div>
            </div>
        </div>
    );
  };

  const BillsView = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());

    const togglePaid = async (billId: string) => {
        const bill = bills.find(b => b.id === billId);
        if(!bill) return;

        const isNowPaid = !bill.isPaid;
        const customer = customers.find(c => c.id === bill.customerId);
        
        try {
            // LOGIKA DENDA SAAT BAYAR
            let finalAmount = bill.amount;
            let denda = bill.details.denda || 0;

            if (isNowPaid) {
                // Saat Tandai Lunas: Cek tanggal
                const today = new Date();
                const currentMonthStr = getCurrentMonth(); // YYYY-MM sekarang
                
                // Jika bulan tagihan LEBIH KECIL dari bulan sekarang (Tunggakan bulan lalu), pasti kena denda
                const isPastMonth = bill.month < currentMonthStr;
                // Jika bulan tagihan SAMA dengan bulan sekarang, cek tanggal > 10
                const isLateDay = today.getDate() > TANGGAL_DENDA;

                if (isPastMonth || (bill.month === currentMonthStr && isLateDay)) {
                    denda = BIAYA_DENDA;
                    // Hitung ulang total: Beban + Pakai + Denda Baru
                    finalAmount = bill.details.beban + bill.details.pakai + denda;
                } else {
                    denda = 0;
                    finalAmount = bill.details.beban + bill.details.pakai;
                }
            } else {
                // Saat Batal Lunas (Kembali ke Unpaid):
                // Reset Denda ke 0 dan kembalikan harga normal agar bersih
                denda = 0;
                finalAmount = bill.details.beban + bill.details.pakai;
            }

            await updateDoc(doc(db, 'bills', billId), {
                isPaid: isNowPaid, 
                paidDate: isNowPaid ? Date.now() : null,
                amount: finalAmount,
                "details.denda": denda
            });

            // Kirim WA Konfirmasi jika tandai LUNAS
            if (isNowPaid && customer) {
                const hasPhone = customer.phone && customer.phone.trim().length > 0;
                if (hasPhone) {
                    let phoneNumber = customer.phone.replace(/\D/g, '');
                    if (phoneNumber.startsWith('0')) phoneNumber = '62' + phoneNumber.slice(1);
                    else if (!phoneNumber.startsWith('62') && phoneNumber.length > 5) phoneNumber = '62' + phoneNumber;

                    let message = `*PAMSIMAS PUNGKURAN*\n\n`;
                    message += `Terima kasih *Bpk/Ibu ${customer.name.toUpperCase()}*.\n`;
                    message += `Pembayaran TAGIHAN PAMSIMAS Anda telah diterima.\n\n`;

                    message += `Rincian Pembayaran:\n`;
                    message += `Tipe: ${customer.type}\n`;
                    
                    const [y, m] = bill.month.split('-');
                    const period = new Date(Number(y), Number(m)-1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                    
                    message += `Periode: ${period}\n`;
                    message += `Tagihan: ${formatCurrency(finalAmount)}\n`; // Gunakan finalAmount yang baru
                    if(denda > 0) {
                        message += `(Termasuk Denda: ${formatCurrency(denda)})\n`;
                    }
                    message += `Status: *LUNAS*\n\n`;
                    message += `_Terima kasih._`;

                    window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`, '_blank');
                }
            }

        } catch (error) {
            console.error("Error updating bill:", error);
            alert("Gagal update status bayar.");
        }
    };

    const filteredBills = bills.filter(b => {
        const cust = customers.find(c => c.id === b.customerId);
        
        // FILTER BY MONTH FIRST
        if (b.month !== selectedMonth) return false;

        let matchStatus = true;
        if (billFilter === 'paid') matchStatus = b.isPaid;
        if (billFilter === 'unpaid') matchStatus = !b.isPaid;

        const matchSearch = (cust?.name || '').toLowerCase().includes(searchQuery.toLowerCase());

        return matchStatus && matchSearch;
    });

    const sortedBills = [...filteredBills].sort((a, b) => b.dateCreated - a.dateCreated);
    let title = "Laporan & Tagihan";
    if (billFilter === 'unpaid') title = "Belum Bayar";
    if (billFilter === 'paid') title = "Sudah Bayar";

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold m-0">{title}</h2>
                <button onClick={() => setView('dashboard')} style={{ color: '#0288D1' }} className="text-sm font-bold bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
            </div>
            
            {/* MONTH FILTER (JUST FILTER, NO DOWNLOAD) */}
            <div className="flex gap-2 mb-4">
                 <input 
                    type="month" 
                    className="input-field" 
                    style={{flex: 1}}
                    value={selectedMonth} 
                    onChange={e => setSelectedMonth(e.target.value)} 
                />
            </div>

            {/* SEARCH BAR */}
            <div className="mb-4">
                 <input className="input-field" placeholder="Cari nama pelanggan..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoComplete="off" />
            </div>

            {/* REMOVED INFO BOX FROM HERE */}

            {sortedBills.length === 0 ? <div className="text-center text-secondary py-10">Tidak ada data untuk periode ini.</div> : <div className="flex flex-col gap-3">
                    {sortedBills.map(bill => {
                        const cust = customers.find(c => c.id === bill.customerId);
                        
                        // --- LOGIKA TAMPILAN OTOMATIS DENDA ---
                        let displayAmount = bill.amount;
                        let potentialDenda = 0;
                        const today = new Date();
                        const currentMonthStr = getCurrentMonth();
                        
                        // Jika Belum Bayar, kita hitung potensi denda secara real-time untuk tampilan
                        if (!bill.isPaid) {
                            const isPastMonth = bill.month < currentMonthStr;
                            const isLateDay = today.getDate() > TANGGAL_DENDA;
                            
                            // Jika telat, tampilkan nominal YANG AKAN DITAGIH (termasuk denda)
                            if (isPastMonth || (bill.month === currentMonthStr && isLateDay)) {
                                potentialDenda = BIAYA_DENDA;
                                // Hitung: Beban + Pakai + Denda (abaikan amount di DB yg mungkin belum ada dendanya)
                                displayAmount = bill.details.beban + bill.details.pakai + potentialDenda;
                            } else {
                                // Jika belum telat, tampilkan amount normal
                                displayAmount = bill.details.beban + bill.details.pakai;
                            }
                        }

                        return (
                            <div key={bill.id} className="card m-0" style={{borderLeft: bill.isPaid ? '4px solid var(--success)' : '4px solid var(--danger)', padding: '1rem'}}>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-lg text-primary capitalize mb-1">{cust?.name || 'Unknown'}</div>
                                        <div className="text-xs text-secondary">{new Date(bill.dateCreated).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</div>
                                        {/* REMOVED DENDA FROM HERE */}
                                    </div>
                                    <div className="text-right flex flex-col items-end">
                                        <div className="font-bold text-lg mb-1">{formatCurrency(displayAmount)}</div>
                                        {/* MOVED DENDA HERE AND UPDATED COLOR/TEXT */}
                                        {(bill.details.denda > 0 || potentialDenda > 0) && <div className="text-xs text-red-600 font-bold mb-1">(termasuk denda {formatCurrency(BIAYA_DENDA)})</div>}
                                        <div className="flex gap-2 justify-end items-center">
                                            {bill.isPaid ? (
                                                <button onClick={() => togglePaid(bill.id)} className="text-sm font-bold underline bg-transparent border-0 p-0 cursor-pointer text-right ml-2" style={{ color: '#EF4444' }}>Batal Lunas</button>
                                            ) : (
                                                <button onClick={() => togglePaid(bill.id)} className="text-sm text-primary font-bold bg-transparent border-0 p-0 underline cursor-pointer text-right ml-2">Tandai Lunas</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>}
        </div>
    );
  };

  const CashBookView = () => {
    const [type, setType] = useState<'in' | 'out'>('out');
    const [desc, setDesc] = useState('');
    const [amount, setAmount] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleSaveTransaction = async () => {
        if(!desc || !amount) return;
        setIsSaving(true);
        try {
            await addDoc(collection(db, 'transactions'), {
                type,
                description: desc,
                amount: Number(amount.replace(/\D/g, '')),
                date: Date.now(),
                isManual: true
            });
            setDesc('');
            setAmount('');
        } catch(e) {
            console.error(e);
            alert('Gagal simpan transaksi');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteTransaction = async (id: string) => {
        if(confirm('Hapus transaksi ini?')) {
            await deleteDoc(doc(db, 'transactions', id));
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold m-0">Input Kas Manual</h2>
                <button onClick={() => setView('dashboard')} style={{ color: '#0288D1' }} className="text-sm font-bold bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
            </div>

            <div className="card">
                <div className="flex mb-4 bg-gray-100 rounded p-1">
                    <button onClick={() => setType('in')} className={`flex-1 py-2 rounded text-sm font-bold transition-all ${type === 'in' ? 'bg-white shadow-sm text-green-600' : 'text-gray-500'}`}>Pemasukan Lain</button>
                    <button onClick={() => setType('out')} className={`flex-1 py-2 rounded text-sm font-bold transition-all ${type === 'out' ? 'bg-white shadow-sm text-red-600' : 'text-gray-500'}`}>Pengeluaran</button>
                </div>
                <div className="input-group">
                    <label>Keterangan</label>
                    <input className="input-field" value={desc} onChange={e => setDesc(e.target.value)} placeholder={type === 'in' ? 'Contoh: Subsidi, Hibah' : 'Contoh: Beli Pipa, Token Listrik'} autoComplete="off" />
                </div>
                <div className="input-group">
                    <label>Jumlah (Rp)</label>
                    <input className="input-field" value={amount} onChange={e => handleMeterInputChange(e.target.value, setAmount)} inputMode="numeric" placeholder="0" autoComplete="off" />
                </div>
                <button onClick={handleSaveTransaction} disabled={!desc || !amount || isSaving} className="btn">
                    {isSaving ? 'Menyimpan...' : 'Simpan Transaksi'}
                </button>
            </div>

            <h3 className="text-sm font-bold text-secondary mb-2 uppercase">Riwayat Transaksi Manual</h3>
            <div className="flex flex-col gap-2 pb-20">
                {manualTransactions.length === 0 ? <div className="text-center text-sm text-secondary py-4">Belum ada transaksi manual.</div> : 
                 manualTransactions.map(t => (
                    <div key={t.id} className="bg-white p-3 rounded border border-gray-200 flex justify-between items-center">
                        <div>
                            <div className="font-bold text-gray-800">{t.description}</div>
                            <div className="text-xs text-secondary">{new Date(t.date).toLocaleDateString('id-ID')}</div>
                        </div>
                        <div className="text-right">
                            <div className={`font-bold ${t.type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                                {t.type === 'in' ? '+' : '-'} {formatCurrency(t.amount)}
                            </div>
                            <button onClick={() => handleDeleteTransaction(t.id)} className="text-xs text-red-400 mt-1 bg-transparent border-0 p-0 cursor-pointer">Hapus</button>
                        </div>
                    </div>
                 ))}
            </div>
        </div>
    );
  };

  if (!isLoggedIn) {
      return (
        <div style={{height: '100%'}}>
            <LoginView 
                onLogin={handleLoginSuccess} 
                installPrompt={installPrompt} 
                onInstall={handleInstallClick}
                isAppInstalled={isAppInstalled}
            />
        </div>
      );
  }

  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
        <div className="app-content">
            {view === 'dashboard' && <DashboardView />}
            {view === 'customers' && <CustomersView />}
            {view === 'recording' && <RecordingView />}
            {view === 'bills' && <BillsView />}
            {view === 'cashbook' && <CashBookView />}
        </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);