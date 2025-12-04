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
    deleteDoc
} from 'firebase/firestore';

// --- Types & Interfaces ---
interface Customer {
  id: string;
  name: string;
  address: string;
  phone: string;
  type: 'Umum' | 'Bisnis';
  lastMeterReading: number;
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
const LoginView = ({ onLogin }: { onLogin: () => void }) => {
    const [u, setU] = useState('');
    const [p, setP] = useState('');
    const [err, setErr] = useState('');

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
                <h2 className="text-xl font-bold text-center mb-4 text-primary">Login</h2>
                <form onSubmit={handleLogin}>
                    <div className="input-group">
                        <label>Username</label>
                        <input className="input-field" style={{color: '#000'}} type="text" value={u} onChange={e => setU(e.target.value)} placeholder="Masukkan username" />
                    </div>
                    <div className="input-group">
                        <label>Password</label>
                        <input className="input-field" style={{color: '#000'}} type="password" value={p} onChange={e => setP(e.target.value)} placeholder="Masukkan password" />
                    </div>
                    {err && <div className="text-red-600 text-sm text-center mb-3">{err}</div>}
                    <button type="submit" className="btn">Masuk</button>
                </form>
            </div>
        </div>
    );
};

// --- Main App Component ---
const App = () => {
  // --- State ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [view, setView] = useState<'dashboard' | 'customers' | 'recording' | 'bills' | 'cashbook'>('dashboard');
  const [billFilter, setBillFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [selectedCustomerForRecording, setSelectedCustomerForRecording] = useState<Customer | null>(null);
  
  // --- FIREBASE DATA STATE ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [manualTransactions, setManualTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // --- FIREBASE SUBSCRIPTIONS (REALTIME SYNC) ---
  useEffect(() => {
    // 1. Subscribe to Customers
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Customer[];
        // Sort alphabetically by name
        data.sort((a, b) => a.name.localeCompare(b.name));
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

  const BackToDashboard = () => (
    <button 
        onClick={() => setView('dashboard')} 
        className="flex items-center cursor-pointer border-0 p-0 hover:opacity-80 transition-opacity bg-transparent"
        style={{ color: '#29B6F6', fontSize: '0.75rem', fontWeight: 'normal', border: 'none', whiteSpace: 'nowrap' }}
    >
        <span className="material-icons-round mr-1" style={{fontSize: '1rem'}}>arrow_back</span> 
        Kembali ke Dashboard
    </button>
  );

  const DashboardView = () => {
    const currentMonth = getCurrentMonth();
    const monthBills = bills.filter(b => b.month === currentMonth);
    const totalCustomers = customers.length;
    
    const usageThisMonth = monthBills.reduce((acc, b) => acc + b.usage, 0);
    const totalUsageLifetime = bills.reduce((acc, b) => acc + b.usage, 0);

    const paidCount = monthBills.filter(b => b.isPaid).length;
    const unpaidCount = monthBills.filter(b => !b.isPaid).length;

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
      <div className="animate-fade-in">
        <h2 className="text-xl font-bold mb-6 text-primary text-center">Dashboard</h2>
        <div className="grid grid-cols-2 gap-4">
          <MenuCard title="Data Pelanggan" value={totalCustomers} subtext="Orang" icon="people" color="#0288D1" onClick={() => setView('customers')} />
          <MenuCard title="Penggunaan" value={`${usageThisMonth} / ${totalUsageLifetime}`} subtext="Kubik (Bln/Tot)" icon="water_drop" color="#00BCD4" onClick={null} />
          <MenuCard title="Sudah Bayar" value={paidCount} subtext="Orang" icon="check_circle" color="#10B981" onClick={() => { setBillFilter('paid'); setView('bills'); }} />
          <MenuCard title="Belum Bayar" value={unpaidCount} subtext="Orang" icon="warning" color="#EF4444" onClick={() => { setBillFilter('unpaid'); setView('bills'); }} />
          <MenuCard title="Kas" value={formatCurrency(lifetimeBalance)} subtext="Saldo Akhir" icon="account_balance_wallet" color="#6366F1" onClick={null} />
          <MenuCard title="Buku Kas" value="Laporan" subtext="Lihat Detail" icon="assessment" color="#F59E0B" onClick={() => setView('cashbook')} />
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
                    lastMeterReading: Number(custForm.initialMeter) || 0
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
                    <BackToDashboard />
                </div>
                <div className="card">
                    <div className="input-group">
                        <label>Nama Lengkap</label>
                        <input className="input-field" value={custForm.name} onChange={e => setCustForm({...custForm, name: e.target.value})} />
                    </div>
                    <div className="input-group">
                        <label>Alamat / Dusun</label>
                        <input className="input-field" value={custForm.address} onChange={e => setCustForm({...custForm, address: e.target.value})} />
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
                        <input className="input-field" value={custForm.phone} onChange={e => setCustForm({...custForm, phone: e.target.value})} type="tel" />
                    </div>
                    <div className="input-group">
                        <label>{editingId ? 'Meteran Terakhir' : 'Meteran Awal'}</label>
                        <input className="input-field text-right font-mono" value={custForm.initialMeter} onChange={e => handleMeterInputChange(e.target.value, (v) => setCustForm({...custForm, initialMeter: v}))} onBlur={e => setCustForm({...custForm, initialMeter: padMeter(e.target.value)})} type="text" inputMode="numeric" placeholder="00000" />
                    </div>
                    <button onClick={handleSave} className="btn mt-4">{editingId ? 'Update Data' : 'Simpan Data'}</button>
                    {editingId && <button onClick={() => { setIsAdding(false); setEditingId(null); setCustForm({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' }); }} className="btn btn-secondary mt-2">Batal</button>}
                </div>
            </div>
        );
    }

    return (
      <div className="relative h-full">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold m-0">Data Pelanggan ({customers.length})</h2>
            <BackToDashboard />
        </div>
        <div className="mb-4">
             <input className="input-field" placeholder="Cari nama atau alamat..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        
        <div className="flex flex-col gap-2 pb-24">
            {filteredCustomers.length === 0 ? <div className="text-center text-secondary py-4">Tidak ditemukan data.</div> : filteredCustomers.map(c => (
                    <div key={c.id} onClick={() => { setSelectedCustomerForRecording(c); setView('recording'); }} className="card m-0 cursor-pointer hover:bg-gray-50 active:scale-98 transition-transform">
                        <div className="flex justify-between items-start mb-1">
                            <div className="font-bold text-lg text-primary capitalize">{c.name}</div>
                            <div className="flex flex-col items-end">
                                <span className={`text-xs font-bold mb-1 ${c.type === 'Bisnis' ? 'text-purple-700' : 'text-gray-700'}`}>{c.type}</span>
                                <button 
                                    onClick={(e) => handleEditClick(e, c)} 
                                    className="text-sm font-bold bg-transparent border-0 p-0 cursor-pointer"
                                    style={{ color: '#29B6F6', zIndex: 2 }}
                                >
                                    Edit
                                </button>
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
    const today = new Date();
    const isLate = today.getDate() > TANGGAL_DENDA;
    const dendaAmount = isLate ? BIAYA_DENDA : 0;
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
                
                let message = `*TAGIHAN PAMSIMAS PUNGKURAN*\n\nYth. ${customer.name}\nPeriode: ${new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}\nTipe: ${customer.type}\n\n📊 *Detail Meter:*\nMeteran Lama : ${padMeter(prevReading)}\nMeteran Baru : ${padMeter(currReadingNum)}\n*Penggunaan Air : ${usage} m³*\n\n💰 *Rincian Tagihan:*\nBiaya Beban : ${formatCurrency(BIAYA_BEBAN)}\nBiaya Pakai : ${formatCurrency(biayaPakai)}\n(${usage}m³ x ${formatCurrency(tarifPerM3)})\n`;
                if(dendaAmount > 0) message += `Denda Keterlambatan : ${formatCurrency(dendaAmount)}\n`;
                
                if(arrearsTotal > 0) {
                    message += `--------------------------\n`;
                    message += `Tagihan Bulan Ini : ${formatCurrency(currentBillAmount)}\n`;
                    message += `Tunggakan (${unpaidBills.length} bln) : ${formatCurrency(arrearsTotal)}\n`;
                }

                message += `\n*TOTAL TAGIHAN : ${formatCurrency(totalToPay)}*\n\nMohon segera melakukan pembayaran.\nTerima kasih. Admin Pamsimas.`;
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
                <BackToDashboard />
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
                    <input type="text" inputMode="numeric" className="w-full p-2 border border-primary rounded text-right font-bold text-lg outline-none focus:ring-2 ring-blue-300 bg-white" value={currentReading} onChange={(e) => handleMeterInputChange(e.target.value, setCurrentReading)} onBlur={() => setCurrentReading(padMeter(currentReading))} placeholder="00000" autoFocus />
                </div>
                <div className="mb-6">
                    <label className="block text-sm text-secondary mb-1">Penggunaan Air (m³)</label>
                    <div className="w-full p-2 bg-blue-50 rounded text-right font-bold text-primary border border-blue-200 text-lg">{usage}</div>
                </div>
                <div className="bg-gray-50 p-4 rounded border border-dashed border-gray-300 mb-6">
                    <div className="text-xs font-bold text-secondary uppercase mb-3 tracking-wider">Rincian Tagihan</div>
                    <div className="flex justify-between text-sm mb-2"><span className="text-gray-600">Biaya Beban</span><span className="font-medium">{formatCurrency(BIAYA_BEBAN)}</span></div>
                    <div className="flex justify-between text-sm mb-2 pb-2 border-b border-gray-200"><span className="text-gray-600">Biaya Pakai&nbsp;<span className="text-xs text-gray-400">({usage} m³ x {formatCurrency(tarifPerM3)})</span></span><span className="font-medium">{formatCurrency(biayaPakai)}</span></div>
                    {dendaAmount > 0 && <div className="flex justify-between text-sm mb-3 text-red-600"><span>Denda (&gt; tgl {TANGGAL_DENDA})</span><span className="font-medium">{formatCurrency(dendaAmount)}</span></div>}
                    
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
    const togglePaid = async (billId: string) => {
        const bill = bills.find(b => b.id === billId);
        if(!bill) return;

        const isNowPaid = !bill.isPaid;
        
        try {
            await updateDoc(doc(db, 'bills', billId), {
                isPaid: isNowPaid, 
                paidDate: isNowPaid ? Date.now() : null 
            });
        } catch (error) {
            console.error("Error updating bill:", error);
            alert("Gagal update status bayar.");
        }
    };

    const filteredBills = bills.filter(b => {
        if (billFilter === 'paid') return b.isPaid;
        if (billFilter === 'unpaid') return !b.isPaid;
        return true; 
    });

    const sortedBills = [...filteredBills].sort((a, b) => b.dateCreated - a.dateCreated);
    let title = "Laporan & Tagihan";
    if (billFilter === 'unpaid') title = "Belum Bayar";
    if (billFilter === 'paid') title = "Sudah Bayar";

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold m-0">{title}</h2>
                <BackToDashboard />
            </div>
            {sortedBills.length === 0 ? <div className="text-center text-secondary py-10">Belum ada data.</div> : <div className="flex flex-col gap-3">
                    {sortedBills.map(bill => {
                        const cust = customers.find(c => c.id === bill.customerId);
                        return (
                            <div key={bill.id} className="card m-0" style={{borderLeft: bill.isPaid ? '4px solid var(--success)' : '4px solid var(--danger)', padding: '1rem'}}>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-lg text-primary capitalize mb-1">{cust?.name || 'Unknown'}</div>
                                        <div className="text-xs text-secondary">{new Date(bill.dateCreated).toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-lg mb-1">{formatCurrency(bill.amount)}</div>
                                        {bill.isPaid ? (
                                            <button onClick={() => togglePaid(bill.id)} className="text-sm font-bold underline bg-transparent border-0 p-0 cursor-pointer" style={{ color: '#EF4444' }}>Batal Lunas</button>
                                        ) : (
                                            <button onClick={() => togglePaid(bill.id)} className="text-sm text-primary font-bold bg-transparent border-0 p-0 underline cursor-pointer">Tandai Lunas</button>
                                        )}
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
      const [showModal, setShowModal] = useState(false);
      const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
      const [currentPage, setCurrentPage] = useState(1);
      const [newTx, setNewTx] = useState<{description: string, amount: string, type: 'in' | 'out', date: string}>({ description: '', amount: '', type: 'in', date: new Date().toISOString().slice(0, 10) });
      const ITEMS_PER_PAGE = 5;

      const handleAddTx = async () => {
          if(!newTx.description || !newTx.amount) return;
          const cleanAmount = Number(newTx.amount.replace(/\./g, ''));
          
          try {
              await addDoc(collection(db, 'transactions'), {
                  description: newTx.description,
                  amount: cleanAmount,
                  type: newTx.type,
                  date: new Date(newTx.date).getTime(),
                  isManual: true
              });
              setNewTx({ description: '', amount: '', type: 'in', date: new Date().toISOString().slice(0, 10) });
              setShowModal(false);
          } catch (error) {
              console.error("Error add transaction:", error);
              alert("Gagal menyimpan transaksi.");
          }
      };

      const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          const val = e.target.value.replace(/\D/g, '');
          setNewTx({...newTx, amount: formatNumberDots(val)});
      };

      const paidBillsAsTx: Transaction[] = bills.filter(b => b.isPaid).map(b => {
          const cust = customers.find(c => c.id === b.customerId);
          return {
              id: b.id,
              type: 'in',
              description: `Tagihan Air: ${cust?.name || 'Pelanggan'}`,
              amount: b.amount,
              date: b.paidDate || b.dateCreated,
              isManual: false,
              sourceId: b.id
          };
      });

      const allTransactions = [...manualTransactions, ...paidBillsAsTx].sort((a, b) => b.date - a.date);
      const filteredTransactions = allTransactions.filter(t => new Date(t.date).toISOString().slice(0, 7) === selectedMonth);

      const monthlyIncome = filteredTransactions.filter(t => t.type === 'in').reduce((acc, t) => acc + t.amount, 0);
      const monthlyExpense = filteredTransactions.filter(t => t.type === 'out').reduce((acc, t) => acc + t.amount, 0);
      const monthlyBalance = monthlyIncome - monthlyExpense;

      const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
      const paginatedTx = filteredTransactions.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

      return (
          <div className="relative h-full">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold m-0">Buku Kas</h2>
                <BackToDashboard />
            </div>

            <div className="mb-4">
                <input type="month" className="input-field" value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setCurrentPage(1); }} />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
                 <div>
                     <div className="text-xs font-bold text-secondary mb-1 ml-1">Pemasukan</div>
                     <div className="card p-2 m-0 border border-green-300 bg-green-50">
                         <div className="text-lg font-bold text-green-600 text-right leading-tight">{formatCurrency(monthlyIncome)}</div>
                     </div>
                 </div>
                 <div>
                     <div className="text-xs font-bold text-secondary mb-1 ml-1">Pengeluaran</div>
                     <div className="card p-2 m-0 border border-red-300 bg-red-50">
                         <div className="text-lg font-bold text-red-600 text-right leading-tight">{formatCurrency(monthlyExpense)}</div>
                     </div>
                 </div>
                 <div>
                     <div className="text-xs font-bold text-secondary mb-1 ml-1">Saldo Bulan Ini</div>
                     <div className="card p-2 m-0 border border-blue-200 bg-blue-50">
                         <div className="text-lg font-bold text-primary text-right leading-tight">{formatCurrency(monthlyBalance)}</div>
                     </div>
                 </div>
                 <div>
                     <div className="text-xs font-bold text-transparent mb-1 ml-1 select-none">.</div>
                     <button onClick={() => setShowModal(true)} className="card p-2 m-0 border border-gray-300 bg-white flex items-center justify-center gap-1 cursor-pointer hover:bg-gray-50 active:scale-95 transition-transform w-full">
                        <span className="material-icons-round text-primary" style={{fontSize: '1.25rem'}}>add_circle</span>
                        <div className="text-xs font-bold text-primary">Tambah</div>
                    </button>
                 </div>
            </div>

            <h3 className="font-bold text-lg m-0 mb-2">Riwayat Transaksi</h3>

            <div className="flex flex-col gap-2 pb-20">
                {paginatedTx.length === 0 ? <div className="text-center text-secondary py-4">Belum ada transaksi bulan ini.</div> : paginatedTx.map(t => (
                    <div key={t.id} className="card p-3 mb-0 flex justify-between items-center">
                        <div>
                            <div className="font-bold text-sm text-primary capitalize">{t.description}</div>
                            <div className="text-xs text-secondary">{new Date(t.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} • {t.isManual ? 'Manual' : 'Otomatis'}</div>
                        </div>
                        <div className={`font-bold text-right ${t.type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                            {t.type === 'in' ? '+' : '-'}{formatCurrency(t.amount)}
                        </div>
                    </div>
                ))}
            </div>

            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 pb-4">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="btn btn-secondary" style={{width: 'auto', padding: '0.5rem 1rem'}}>Prev</button>
                    <span className="text-sm text-secondary">Halaman {currentPage} / {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="btn btn-secondary" style={{width: 'auto', padding: '0.5rem 1rem'}}>Next</button>
                </div>
            )}

            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" style={{backgroundColor: 'rgba(0,0,0,0.5)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <div className="card w-full max-w-sm animate-fade-in" style={{margin: 0}}>
                        <h3 className="text-lg font-bold mb-4">Tambah Transaksi</h3>
                        <div className="input-group">
                            <label>Keterangan</label>
                            <input className="input-field" value={newTx.description} onChange={e => setNewTx({...newTx, description: e.target.value})} placeholder="Contoh: Beli Pipa" />
                        </div>
                        <div className="input-group">
                            <label>Jenis</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => setNewTx({...newTx, type: 'in'})} className={`btn ${newTx.type === 'in' ? 'bg-green-100 text-green-800 border-green-300' : 'btn-secondary'}`} style={{backgroundColor: newTx.type === 'in' ? '#dcfce7' : '', color: newTx.type === 'in' ? '#166534' : ''}}>Pemasukan</button>
                                <button onClick={() => setNewTx({...newTx, type: 'out'})} className={`btn ${newTx.type === 'out' ? 'bg-red-100 text-red-800 border-red-300' : 'btn-secondary'}`} style={{backgroundColor: newTx.type === 'out' ? '#fee2e2' : '', color: newTx.type === 'out' ? '#991b1b' : ''}}>Pengeluaran</button>
                            </div>
                        </div>
                        <div className="input-group">
                            <label>Jumlah (Rp)</label>
                            <input className="input-field text-right" type="text" inputMode="numeric" value={newTx.amount} onChange={handleAmountChange} placeholder="0" />
                        </div>
                        <div className="input-group">
                            <label>Tanggal</label>
                            <input type="date" className="input-field" value={newTx.date} onChange={e => setNewTx({...newTx, date: e.target.value})} />
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setShowModal(false)} className="btn btn-secondary">Batal</button>
                            <button onClick={handleAddTx} className="btn">Simpan</button>
                        </div>
                    </div>
                </div>
            )}
          </div>
      );
  };

  // --- Main Render ---
  if (!isLoggedIn) {
      return <LoginView onLogin={() => setIsLoggedIn(true)} />;
  }
  
  // Show loading indicator when first fetching data
  if (isLoading && customers.length === 0 && bills.length === 0) {
      return (
          <div style={{height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'}}>
              <div className="font-bold text-primary text-xl mb-2">Memuat Data...</div>
              <div className="text-secondary text-sm">Menghubungkan ke server</div>
          </div>
      );
  }

  return (
    <>
      <header className="app-header" style={{flexDirection: 'column', justifyContent: 'center', textAlign: 'center', height: 'auto', padding: '1rem 1rem'}}>
        <div className="w-full flex justify-between items-start absolute top-0 left-0 p-4">
             {view !== 'dashboard' ? (
                <button 
                    onClick={() => setView('dashboard')} 
                    className="bg-transparent border-0 p-0 text-white cursor-pointer"
                >
                    <span className="material-icons-round" style={{ fontSize: '1.5rem' }}>arrow_back</span>
                </button>
            ) : <div />}
        </div>
        
        <h1 className="text-xl font-bold m-0 leading-none mb-1 mt-6">PAMSIMAS PUNGKURAN</h1>
        <div className="flex flex-col justify-center items-center leading-none">
            <div className="text-sm opacity-90 font-medium">PUNGKURAN KWANGSAN JUMAPOLO</div>
            <div className="text-sm opacity-90 font-medium">KARANGANYAR</div>
        </div>
      </header>

      <main className="app-content">
        {view === 'dashboard' && <DashboardView />}
        {view === 'customers' && <CustomersView />}
        {view === 'recording' && <RecordingView />}
        {view === 'bills' && <BillsView />}
        {view === 'cashbook' && <CashBookView />}
      </main>

      <footer className="app-footer">copyright admin.pampunk 2026</footer>
    </>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);