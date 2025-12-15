import React, { useState, useEffect } from 'react';
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
  type: 'Umum' | 'Bisnis' | 'Sosial';
  lastMeterReading: number;
  createdAt?: number;
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
    type: 'in' | 'out';
    description: string;
    amount: number;
    date: number;
    isManual: boolean;
    sourceId?: string;
}

// --- Constants & Config ---
const BIAYA_BEBAN = 7000;
const BIAYA_DENDA = 5000; 
const TARIF_UMUM = 1500;
const TARIF_BISNIS = 3000;
const TARIF_SOSIAL = 0; // Gratis biaya pakai

// --- Helper Functions ---
const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
const getCurrentMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const getMonthName = (yearMonth: string) => {
    const [year, month] = yearMonth.split('-');
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
};

const toTitleCase = (str: string) => {
    if (!str) return '';
    return str.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
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

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
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
                    <div className="mb-2">
                        <span className="material-icons-round" style={{ fontSize: '40px', color: '#0288D1' }}>water_drop</span>
                    </div>
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

// --- Bills Component (Extracted) ---
const BillsView = ({ 
    bills, 
    customers, 
    billFilter, 
    setView 
}: { 
    bills: Bill[], 
    customers: Customer[], 
    billFilter: string, 
    setView: (view: any) => void 
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());

    const togglePaid = async (billId: string) => {
        const bill = bills.find(b => b.id === billId);
        if(!bill) return;

        const isNowPaid = !bill.isPaid;
        const customer = customers.find(c => c.id === bill.customerId);
        
        try {
            let finalAmount = bill.amount;
            let denda = 0;

            if (isNowPaid) {
                 const currentMonthStr = getCurrentMonth();
                 // Denda diterapkan pada bulan berikutnya jika bukan tipe Sosial
                 if (bill.month < currentMonthStr) {
                     // SOSIAL: Denda tetap 0
                     if (customer && customer.type === 'Sosial') {
                         denda = 0;
                     } else {
                         denda = BIAYA_DENDA;
                     }
                 } else {
                     denda = 0;
                 }
                 finalAmount = bill.details.beban + bill.details.pakai + denda;
            } else {
                denda = 0;
                finalAmount = bill.details.beban + bill.details.pakai;
            }

            await updateDoc(doc(db, 'bills', billId), {
                isPaid: isNowPaid, 
                paidDate: isNowPaid ? Date.now() : null,
                amount: finalAmount,
                "details.denda": denda
            });

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
                    message += `Tagihan: ${formatCurrency(finalAmount)}\n`; 
                    if(denda > 0) message += `(Termasuk Denda: ${formatCurrency(denda)})\n`;
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
                <button onClick={() => setView('dashboard')} style={{ color: '#0288D1' }} className="text-sm bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
            </div>
            
            <div className="flex gap-2 mb-4">
                 <input type="month" className="input-field" style={{flex: 1}} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
            </div>

            <div className="mb-4">
                 <input className="input-field" placeholder="Cari nama pelanggan..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoComplete="off" />
            </div>

            {sortedBills.length === 0 ? <div className="text-center text-secondary py-10">Tidak ada data untuk periode ini.</div> : <div className="flex flex-col gap-3">
                    {sortedBills.map(bill => {
                        const cust = customers.find(c => c.id === bill.customerId);
                        const currentMonthStr = getCurrentMonth();
                        const baseAmount = bill.details.beban + bill.details.pakai;
                        
                        // Calculate Arrears (Tunggakan)
                        // Sum of amounts of ALL unpaid bills for this customer created BEFORE this bill
                        const arrears = bills.filter(b => 
                            b.customerId === bill.customerId && 
                            !b.isPaid && 
                            b.dateCreated < bill.dateCreated
                        ).reduce((sum, b) => sum + b.amount, 0);

                        let displayDenda = 0;
                        if (!bill.isPaid) {
                            if (bill.month < currentMonthStr) {
                                // SOSIAL: Denda = 0
                                if (cust && cust.type === 'Sosial') {
                                    displayDenda = 0;
                                } else {
                                    displayDenda = BIAYA_DENDA;
                                }
                            }
                        } else {
                            displayDenda = bill.details.denda;
                        }

                        // Total display includes arrears only if bill is not paid
                        const totalDisplay = baseAmount + displayDenda + (bill.isPaid ? 0 : arrears);

                        // Colors for inner box
                        const innerBorderColor = bill.isPaid ? '#bbf7d0' : '#fecaca'; // Lighter green/red
                        const innerBgColor = bill.isPaid ? '#f0fdf4' : '#fef2f2'; // Very light green/red

                        return (
                            <div key={bill.id} className="card m-0" style={{
                                border: bill.isPaid ? '1px solid var(--success)' : '1px solid var(--danger)',
                                borderLeftWidth: '4px',
                                padding: '1rem'
                            }}>
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-bold text-lg text-primary capitalize">{cust?.name ? toTitleCase(cust.name) : 'Unknown'}</div>
                                            <div className="text-sm text-secondary mb-2">
                                                {new Date(bill.dateCreated).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'})}
                                            </div>
                                        </div>
                                        <div>
                                            {bill.isPaid ? (
                                                <button onClick={() => togglePaid(bill.id)} className="bg-transparent border-0 cursor-pointer flex items-center justify-center p-1" style={{color: '#EF4444'}} title="Batalkan Lunas">
                                                     <span className="material-icons-round" style={{fontSize: '24px'}}>cancel</span>
                                                </button>
                                            ) : (
                                                <button onClick={() => togglePaid(bill.id)} className="bg-transparent border-0 cursor-pointer flex items-center justify-center p-1" style={{color: '#10B981'}} title="Tandai Lunas">
                                                     <span className="material-icons-round" style={{fontSize: '24px'}}>check_circle</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="mt-2 mb-2 p-3 rounded" style={{
                                        backgroundColor: innerBgColor,
                                        border: `1px solid ${innerBorderColor}`
                                    }}>
                                        <div className="text-sm font-bold text-secondary mb-2">Rincian Tagihan</div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">Biaya Beban</span>
                                            <span className="font-medium">{formatCurrency(bill.details.beban)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-gray-600">Biaya Pakai</span>
                                            <span className="font-medium">{formatCurrency(bill.details.pakai)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm text-red-600 mb-1">
                                            <span>Denda</span>
                                            <span className="font-medium">{formatCurrency(displayDenda)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm text-red-600">
                                            <span>Tunggakan</span>
                                            <span className="font-medium">{formatCurrency(bill.isPaid ? 0 : arrears)}</span>
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-center mt-1">
                                        <span className="text-sm font-bold text-gray-800">Total Tagihan</span>
                                        <span className="text-sm font-bold text-primary">{formatCurrency(totalDisplay)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>}
        </div>
    );
};

// --- Main App Component ---
const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('pamsimas_auth') === 'true');
  const [view, setView] = useState<'dashboard' | 'customers' | 'recording' | 'bills' | 'cashbook'>('dashboard');
  const [billFilter, setBillFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [selectedCustomerForRecording, setSelectedCustomerForRecording] = useState<Customer | null>(null);
  
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [manualTransactions, setManualTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const handleLoginSuccess = () => {
      localStorage.setItem('pamsimas_auth', 'true');
      setIsLoggedIn(true);
  };

  const handleLogout = () => {
      if(confirm('Apakah Anda yakin ingin keluar dari aplikasi?')) {
          localStorage.removeItem('pamsimas_auth');
          setIsLoggedIn(false);
          setView('dashboard');
      }
  };

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) {
        setIsAppInstalled(true);
    }
    const handler = (e: any) => {
        e.preventDefault();
        setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
            setInstallPrompt(null);
        }
    });
  };

  useEffect(() => {
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Customer[];
        data.sort((a, b) => {
            const timeA = a.createdAt || 0;
            const timeB = b.createdAt || 0;
            if (timeA !== timeB) return timeA - timeB; 
            return a.name.localeCompare(b.name);
        });
        setCustomers(data);
    });

    const qBills = query(collection(db, 'bills'), orderBy('dateCreated', 'desc'));
    const unsubBills = onSnapshot(qBills, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Bill[];
        setBills(data);
    });

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
      <div className="animate-fade-in flex flex-col h-full">
        <h2 className="text-xl font-bold mb-6 text-primary text-center">Dashboard</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <MenuCard title="Data Pelanggan" value={totalCustomers} subtext="Orang" icon="people" color="#0288D1" onClick={() => setView('customers')} />
          <MenuCard title="Penggunaan" value={`${usageThisMonth} / ${totalUsageLifetime}`} subtext="Kubik (Bln/Tot)" icon="water_drop" color="#00BCD4" onClick={null} />
          <MenuCard title="Sudah Bayar" value={paidCount} subtext="Orang" icon="check_circle" color="#10B981" onClick={() => { setBillFilter('paid'); setView('bills'); }} />
          <MenuCard title="Belum Bayar" value={unpaidCount} subtext="Orang" icon="warning" color="#EF4444" onClick={() => { setBillFilter('unpaid'); setView('bills'); }} />
          <MenuCard title="Kas" value={formatCurrency(lifetimeBalance)} subtext="Saldo Akhir" icon="account_balance_wallet" color="#6366F1" onClick={null} />
          <MenuCard title="Laporan" value="Buku Kas" subtext="Transaksi" icon="edit_note" color="#F59E0B" onClick={() => setView('cashbook')} />
        </div>
        
        <div className="mt-4 flex flex-col items-center gap-3">
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
    const [custForm, setCustForm] = useState<{name: string, address: string, phone: string, initialMeter: string, type: 'Umum' | 'Bisnis' | 'Sosial'}>({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' });

    const handleSave = async () => {
        if(!custForm.name) return;
        try {
            const dataToSave = {
                name: custForm.name,
                address: custForm.address,
                phone: custForm.phone,
                type: custForm.type,
                lastMeterReading: Number(custForm.initialMeter) || 0
            };

            if (editingId) {
                await updateDoc(doc(db, 'customers', editingId), dataToSave);
            } else {
                await addDoc(collection(db, 'customers'), {
                    ...dataToSave,
                    createdAt: Date.now()
                });
            }
        } catch (error) {
            console.error("Error saving customer:", error);
            alert("Gagal menyimpan data.");
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
                        <select className="input-field" value={custForm.type} onChange={e => setCustForm({...custForm, type: e.target.value as any})}>
                            <option value="Umum">Umum</option>
                            <option value="Bisnis">Bisnis</option>
                            <option value="Sosial">Sosial</option>
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
            <button onClick={() => setView('dashboard')} style={{ color: '#0288D1' }} className="text-sm bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
        </div>
        <div className="mb-4">
             <input className="input-field" placeholder="Cari nama atau alamat..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoComplete="off" />
             <button 
                onClick={() => { setIsAdding(true); setEditingId(null); setCustForm({ name: '', address: '', phone: '', initialMeter: '', type: 'Umum' }); }} 
                className="w-full mt-2 py-2 px-3 rounded bg-primary text-white border-0 flex items-center justify-center gap-2 cursor-pointer text-sm"
                style={{ backgroundColor: '#0288D1', fontWeight: 400, borderRadius: '8px' }}
            >
                <span className="material-icons-round" style={{fontSize: '18px'}}>add</span>
                Tambah Pelanggan
            </button>
        </div>
        
        <div className="flex flex-col gap-2 pb-24">
            {filteredCustomers.length === 0 ? <div className="text-center text-secondary py-4">Tidak ditemukan data.</div> : filteredCustomers.map((c) => (
                    <div 
                        key={c.id} 
                        onClick={() => { setSelectedCustomerForRecording(c); setView('recording'); }} 
                        className="card m-0 cursor-pointer hover:bg-gray-50 active:scale-98 transition-transform"
                    >
                        <div className="flex justify-between items-stretch">
                            <div className="flex flex-col">
                                <div className="font-bold text-lg text-primary leading-tight mb-2">
                                    {toTitleCase(c.name)}
                                </div>
                                <div className="text-secondary capitalize text-sm leading-tight mb-0.5 flex items-center gap-1 mt-1">
                                    <span className="material-icons-round text-sm" style={{fontSize: '14px'}}>location_on</span>
                                    {c.address}
                                </div>
                                <div className="text-secondary text-sm leading-tight flex items-center gap-1">
                                    <span className="material-icons-round text-sm" style={{fontSize: '14px'}}>phone</span>
                                    {c.phone || '-'}
                                </div>
                            </div>
                            
                            <div className="flex flex-col items-end justify-between pl-2">
                                <button 
                                    onClick={(e) => handleEditClick(e, c)} 
                                    className="bg-transparent border-0 p-0 cursor-pointer"
                                    style={{color: '#29B6F6'}}
                                >
                                    <span className="material-icons-round" style={{fontSize: '10px'}}>mode_edit</span>
                                </button>
                                
                                <span className={`text-sm ${c.type === 'Bisnis' ? 'text-orange-700' : c.type === 'Sosial' ? 'text-green-700' : 'text-purple-700'}`}>
                                    {c.type}
                                </span>
                            </div>
                        </div>
                    </div>
            ))}
        </div>
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
    
    // Tentukan Tarif
    const tarifPerM3 = customer.type === 'Bisnis' ? TARIF_BISNIS : customer.type === 'Sosial' ? TARIF_SOSIAL : TARIF_UMUM;
    
    const biayaPakai = usage * tarifPerM3;
    const dendaAmount = 0; // Default saat pencatatan
    
    const currentBillAmount = BIAYA_BEBAN + biayaPakai + dendaAmount;
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
            await addDoc(collection(db, 'bills'), newBillData);
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
                if (tarifPerM3 > 0) {
                     message += `* Biaya Pakai: ${formatCurrency(biayaPakai)}\n`;
                     message += `(${usage} m³ x ${formatCurrency(tarifPerM3)})\n\n`;
                } else {
                     message += `* Biaya Pakai: GRATIS (Sosial)\n\n`;
                }
                
                if (arrearsTotal > 0) {
                     message += `* Tunggakan: ${formatCurrency(arrearsTotal)}\n`;
                }

                message += `*TOTAL TAGIHAN: ${formatCurrency(totalToPay)}*\n\n`;
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
                <button onClick={() => setView('customers')} style={{ color: '#0288D1' }} className="text-sm bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
            </div>
            <div className="card bg-blue-50 border-blue-200 mb-4">
                <div className="flex justify-between items-end mb-1">
                    <div className="font-bold text-lg text-primary capitalize leading-none">{toTitleCase(customer.name)}</div>
                    <div className="flex flex-col items-end">
                        <span className={`text-sm mb-0.5 ${customer.type === 'Bisnis' ? 'text-orange-700' : customer.type === 'Sosial' ? 'text-green-700' : 'text-purple-700'}`}>{customer.type}</span>
                    </div>
                </div>
                <div className="text-sm text-secondary flex items-center gap-1 mb-0.5"><span className="material-icons-round text-xs w-4">location_on</span>{customer.address}</div>
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
                    <div className="text-sm font-bold text-secondary uppercase mb-2 tracking-wider">Rincian Tagihan</div>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-sm"><span className="text-gray-600">Biaya Beban</span><span className="font-medium">{formatCurrency(BIAYA_BEBAN)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-gray-600">Biaya Pakai&nbsp;<span className="text-xs text-gray-400">({usage} m³ x {formatCurrency(tarifPerM3)})</span></span><span className="font-medium">{formatCurrency(biayaPakai)}</span></div>
                        <div className="flex justify-between text-sm text-red-600">
                            <span>Denda</span>
                            <span className="font-medium">{formatCurrency(0)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-red-600">
                            <span>Tunggakan</span>
                            <span className="font-medium">{formatCurrency(arrearsTotal)}</span>
                        </div>
                    </div>
                    <div className="flex justify-between items-center border-t border-gray-300 pt-2 mt-2"><span className="font-bold text-lg text-gray-800">Total Tagihan</span><span className="font-bold text-xl text-primary">{formatCurrency(totalToPay)}</span></div>
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

  const CashBookView = () => {
    const [type, setType] = useState<'in' | 'out'>('out');
    const [desc, setDesc] = useState('');
    const [amount, setAmount] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
    const [showForm, setShowForm] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const handleDownloadReport = () => {
        const billsInMonth = bills.filter(b => b.month === selectedMonth);
        const transactionsInMonth = manualTransactions.filter(t => new Date(t.date).toISOString().slice(0, 7) === selectedMonth);
        
        // 1. Calculate Income (Month)
        const waterIncome = billsInMonth.filter(b => b.isPaid).reduce((sum, b) => sum + b.amount, 0);
        const incomeTxns = transactionsInMonth.filter(t => t.type === 'in');
        const manualIncomeTotal = incomeTxns.reduce((sum, t) => sum + t.amount, 0);
        const totalIncome = waterIncome + manualIncomeTotal;
        
        // 2. Calculate Expense (Month)
        const expenseTxns = transactionsInMonth.filter(t => t.type === 'out');
        const totalExpense = expenseTxns.reduce((sum, t) => sum + t.amount, 0);
        
        // 3. Balance (Month)
        const balance = totalIncome - totalExpense;

        // 4. Calculate Lifetime Balance (Total Saldo Akumulasi)
        const totalBillIncomeLifetime = bills.filter(b => b.isPaid).reduce((acc, b) => acc + b.amount, 0);
        const totalManualIncomeLifetime = manualTransactions.filter(t => t.type === 'in').reduce((acc, t) => acc + t.amount, 0);
        const totalManualExpenseLifetime = manualTransactions.filter(t => t.type === 'out').reduce((acc, t) => acc + t.amount, 0);
        const lifetimeBalance = (totalBillIncomeLifetime + totalManualIncomeLifetime) - totalManualExpenseLifetime;

        // Helper to format currency for CSV (e.g. "Rp 10.000")
        const fmt = (num: number) => `Rp ${new Intl.NumberFormat('id-ID').format(num)}`;

        let csvContent = "data:text/csv;charset=utf-8,";
        
        // HEADER
        csvContent += "LAPORAN KEUANGAN PAMSIMAS PUNGKURAN\n";
        csvContent += `Periode;${getMonthName(selectedMonth)}\n\n`;

        // SECTION: PEMASUKAN
        csvContent += "PEMASUKAN\n";
        // Item 1: Tagihan Air
        csvContent += `1. Total Tagihan Pelanggan;${fmt(waterIncome)}\n`;
        // Item 2..n: Transaksi Manual Pemasukan
        incomeTxns.forEach((t, idx) => {
            csvContent += `${idx + 2}. ${t.description} (Manual);${fmt(t.amount)}\n`;
        });
        csvContent += `TOTAL PEMASUKAN;${fmt(totalIncome)}\n\n`;

        // SECTION: PENGELUARAN
        csvContent += "PENGELUARAN\n";
        expenseTxns.forEach((t, idx) => {
            csvContent += `${idx + 1}. ${t.description};${fmt(t.amount)}\n`;
        });
        csvContent += `TOTAL PENGELUARAN;${fmt(totalExpense)}\n\n`;

        // SECTION: SALDO
        csvContent += `SALDO PERIODE INI;${fmt(balance)}\n`;
        csvContent += `TOTAL SALDO (SEMUA PERIODE);${fmt(lifetimeBalance)}\n\n`;
        
        // SECTION: TABLE DETAIL
        csvContent += "RINCIAN TAGIHAN PELANGGAN\n";
        csvContent += "No;Nama Pelanggan;Meteran Lama;Meteran Baru;Jumlah Tagihan;Denda;Tunggakan;Status\n";

        const sortedBillsForReport = [...billsInMonth].sort((a, b) => {
             const custA = customers.find(c => c.id === a.customerId)?.name || '';
             const custB = customers.find(c => c.id === b.customerId)?.name || '';
             return custA.localeCompare(custB);
        });

        sortedBillsForReport.forEach((b, index) => {
            const cust = customers.find(c => c.id === b.customerId);
            const rawName = cust?.name || 'Unknown';
            // Pastikan nama menggunakan Huruf Kapital di Awal Kata
            const custName = toTitleCase(rawName);

            const jumlahTagihanMurni = b.details.beban + b.details.pakai;
            const denda = b.details.denda;
            const tunggakan = !b.isPaid ? (jumlahTagihanMurni + denda) : 0;
            const status = b.isPaid ? "Lunas" : "Belum Bayar";
            
            const row = [
                index + 1, 
                `"${custName}"`, 
                b.prevReading, 
                b.currReading, 
                fmt(jumlahTagihanMurni), 
                fmt(denda), 
                fmt(tunggakan), 
                status
            ].join(";");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Laporan_Pamsimas_${selectedMonth}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

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
            setShowForm(false);
            setCurrentPage(1);
        } catch(e) {
            console.error(e);
            alert('Gagal simpan transaksi');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteTransaction = async (id: string, isManual: boolean) => {
        if (!isManual) {
            alert("Transaksi dari tagihan air tidak bisa dihapus disini. Silahkan batalkan lunas di menu Tagihan.");
            return;
        }
        if(confirm('Hapus transaksi ini?')) {
            await deleteDoc(doc(db, 'transactions', id));
        }
    };

    const manualTxns = manualTransactions.map(t => ({
        ...t,
        source: 'manual',
        sortDate: t.date 
    }));

    const paidBillTxns = bills.filter(b => b.isPaid).map(b => {
        const cust = customers.find(c => c.id === b.customerId);
        const name = cust?.name || 'Unknown';
        const descTitleCase = `Tagihan ${toTitleCase(name)}`;
        return {
            id: b.id,
            type: 'in' as 'in',
            description: descTitleCase,
            amount: b.amount,
            date: b.paidDate || b.dateCreated,
            sortDate: b.paidDate || b.dateCreated,
            isManual: false,
            source: 'bill'
        };
    });

    const allTransactions = [...manualTxns, ...paidBillTxns]
        .filter(t => new Date(t.sortDate).toISOString().slice(0, 7) === selectedMonth)
        .sort((a, b) => b.sortDate - a.sortDate);

    const totalInMonth = allTransactions.filter(t => t.type === 'in').reduce((sum, t) => sum + t.amount, 0);
    const totalOutMonth = allTransactions.filter(t => t.type === 'out').reduce((sum, t) => sum + t.amount, 0);
    const balanceMonth = totalInMonth - totalOutMonth;

    const totalPages = Math.ceil(allTransactions.length / itemsPerPage);
    const paginatedTransactions = allTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const handleNext = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };
    const handlePrev = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold m-0">Buku Kas & Transaksi</h2>
                <button onClick={() => setView('dashboard')} style={{ color: '#0288D1' }} className="text-sm bg-transparent border-0 p-0 cursor-pointer">Kembali</button>
            </div>

            <div className="mb-4">
                 <input type="month" className="input-field text-center" value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setCurrentPage(1); }} />
            </div>

            <div className="flex flex-col gap-4 mb-6">
                <div className="p-4 rounded flex justify-between items-center shadow-sm" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <div className="text-green-800 font-bold text-lg">Pemasukan</div>
                    <div className="text-green-600 font-bold text-lg">{formatCurrency(totalInMonth)}</div>
                </div>
                <div className="p-4 rounded flex justify-between items-center shadow-sm" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
                    <div className="text-red-800 font-bold text-lg">Pengeluaran</div>
                    <div className="text-red-600 font-bold text-lg">{formatCurrency(totalOutMonth)}</div>
                </div>
                <div className="p-4 rounded flex justify-between items-center shadow-sm" style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
                    <div className="text-blue-800 font-bold text-lg">Saldo Bulan Ini</div>
                    <div className="text-blue-800 font-bold text-lg">{formatCurrency(balanceMonth)}</div>
                </div>
            </div>

            {!showForm && (
                <div className="mb-8 flex flex-col items-center mt-8" style={{ gap: '9px' }}>
                    <button 
                        onClick={() => setShowForm(true)} 
                        className="btn shadow-sm" 
                        style={{
                            backgroundColor: '#10B981', 
                            width: 'auto', 
                            padding: '0.6rem 1.5rem',
                            fontSize: '0.9rem'
                        }}
                    >
                        <span className="material-icons-round" style={{fontSize: '1.2rem'}}>add</span>
                        Tambah Transaksi
                    </button>
                    <button 
                        onClick={handleDownloadReport} 
                        className="bg-transparent border-0 cursor-pointer p-0 flex items-center gap-1 text-xs hover:opacity-80 transition-opacity"
                        style={{width: 'auto', color: '#0288D1'}}
                    >
                        <span className="material-icons-round" style={{fontSize: '16px'}}>download</span>
                        Download Laporan (CSV)
                    </button>
                </div>
            )}

            {showForm && (
                <div className="card animate-fade-in mb-6 border-l-4 border-yellow-400">
                    <div className="flex justify-between items-center mb-4">
                         <div className="font-bold text-gray-800" style={{fontSize: '0.9rem'}}>Transaksi Baru</div>
                         <button onClick={() => setShowForm(false)} className="text-xs text-red-500 font-bold bg-transparent border-0 p-0 cursor-pointer">Batal</button>
                    </div>
                    <div className="input-group">
                        <label>Keterangan</label>
                        <input className="input-field" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Contoh: Beli Token, Subsidi" autoComplete="off" />
                    </div>
                    <div className="input-group">
                        <label>Jenis Transaksi</label>
                        <select 
                            className="input-field bg-white" 
                            value={type} 
                            onChange={e => setType(e.target.value as 'in' | 'out')}
                            style={{
                                color: type === 'in' ? '#16a34a' : '#dc2626',
                                fontWeight: 400
                            }}
                        >
                            <option value="in" style={{color: '#16a34a'}}>Pemasukan</option>
                            <option value="out" style={{color: '#dc2626'}}>Pengeluaran</option>
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Jumlah (Rp)</label>
                        <input className="input-field" value={amount} onChange={e => handleMeterInputChange(e.target.value, setAmount)} inputMode="numeric" placeholder="0" autoComplete="off" />
                    </div>
                    <button onClick={handleSaveTransaction} disabled={!desc || !amount || isSaving} className="btn">
                        {isSaving ? 'Menyimpan...' : 'Simpan'}
                    </button>
                </div>
            )}

            <h3 className="text-sm font-bold text-secondary uppercase mb-2">Riwayat Transaksi</h3>
            
            <div className="flex flex-col gap-2 pb-6">
                {paginatedTransactions.length === 0 ? <div className="text-center text-sm text-secondary py-4">Belum ada transaksi di bulan ini.</div> : 
                 paginatedTransactions.map((t, idx) => (
                    <div key={`${t.id}-${idx}`} className="bg-white p-3 rounded border border-gray-200 flex justify-between items-center shadow-sm">
                        <div style={{maxWidth: '65%'}}>
                            <div className="font-bold text-gray-800 text-sm">{toTitleCase(t.description)}</div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-secondary">{new Date(t.sortDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className={`font-bold ${t.type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                                {t.type === 'in' ? '+' : '-'} {formatCurrency(t.amount)}
                            </div>
                            {t.isManual && (
                                <button onClick={() => handleDeleteTransaction(t.id, t.isManual)} className="text-xs text-red-400 mt-1 bg-transparent border-0 p-0 cursor-pointer">Hapus</button>
                            )}
                        </div>
                    </div>
                 ))}
            </div>

            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 pb-20">
                    <button onClick={handlePrev} disabled={currentPage === 1} className={`p-2 rounded-full border ${currentPage === 1 ? 'text-gray-300 border-gray-200' : 'text-primary border-primary bg-white'}`}>
                        <span className="material-icons-round">chevron_left</span>
                    </button>
                    <span className="text-sm text-secondary font-medium">Hal {currentPage} dari {totalPages}</span>
                    <button onClick={handleNext} disabled={currentPage === totalPages} className={`p-2 rounded-full border ${currentPage === totalPages ? 'text-gray-300 border-gray-200' : 'text-primary border-primary bg-white'}`}>
                        <span className="material-icons-round">chevron_right</span>
                    </button>
                </div>
            )}
            {totalPages <= 1 && <div className="pb-20"></div>}
        </div>
    );
  };

  if (!isLoggedIn) {
      return (
        <div style={{height: '100%'}}>
            <LoginView onLogin={handleLoginSuccess} installPrompt={installPrompt} onInstall={handleInstallClick} isAppInstalled={isAppInstalled} />
        </div>
      );
  }

  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
        <div className="app-content">
            {view === 'dashboard' && <DashboardView />}
            {view === 'customers' && <CustomersView />}
            {view === 'recording' && <RecordingView />}
            {view === 'bills' && <BillsView bills={bills} customers={customers} billFilter={billFilter} setView={setView} />}
            {view === 'cashbook' && <CashBookView />}
        </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);