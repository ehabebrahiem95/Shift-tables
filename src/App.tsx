/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  Users, 
  Plus, 
  Trash2, 
  CheckCircle, 
  LogOut, 
  LogIn,
  BrainCircuit,
  CalendarDays,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  signIn, 
  logOut, 
  OperationType, 
  handleFirestoreError 
} from './lib/firebase';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  deleteDoc, 
  updateDoc, 
  orderBy,
  Timestamp,
  where
} from 'firebase/firestore';
import { suggestShifts } from './services/geminiService';
import { checkPairConflict, normalizeText } from './lib/utils';

interface Shift {
  id: string;
  title: string;
  startTime: Timestamp;
  endTime: Timestamp;
  userId: string | null;
  status: 'pending' | 'confirmed' | 'completed';
  notes?: string;
}

interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'employee';
  availability?: any;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [activeTab, setActiveTab] = useState<'calendar' | 'admin' | 'profile' | 'stats' | 'search'>('calendar');
  const [searchName, setSearchName] = useState('');
  const [searchResults, setSearchResults] = useState<Shift[]>([]);
  const [stats, setStats] = useState<any>({ fri: [], sat: [], tue: [], total: [] });
  const [swapSelection, setSwapSelection] = useState<Shift | null>(null);

  // Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userRef = doc(db, 'users', u.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            const newUser: AppUser = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || 'User',
              role: u.email === 'ehabebrahiem95@gmail.com' ? 'admin' : 'employee',
            };
            await setDoc(userRef, { ...newUser, createdAt: Timestamp.now() });
            setAppUser(newUser);
          } else {
            setAppUser(userSnap.data() as AppUser);
          }
        } catch (e) {
          console.error("Error syncing user:", e);
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Listen to Shifts
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'shifts'), orderBy('startTime', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const s = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Shift));
      setShifts(s);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'shifts');
    });
    return unsubscribe;
  }, [user]);

  // Listen to Employees (Admin only)
  useEffect(() => {
    if (appUser?.role !== 'admin') return;
    const q = query(collection(db, 'users'), where('role', '==', 'employee'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const e = snapshot.docs.map(d => d.data() as AppUser);
      setEmployees(e);
    });
    return unsubscribe;
  }, [appUser]);

  const handleAddShift = async () => {
    if (appUser?.role !== 'admin') return;
    const now = new Date();
    const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
    const endTime = new Date(startTime.getTime() + 8 * 60 * 60 * 1000);

    try {
      await addDoc(collection(db, 'shifts'), {
        title: 'شيفت جديد',
        startTime: Timestamp.fromDate(startTime),
        endTime: Timestamp.fromDate(endTime),
        userId: null,
        status: 'pending',
        createdAt: Timestamp.now()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'shifts');
    }
  };

  const handleSmartSuggest = async () => {
    if (appUser?.role !== 'admin') return;
    setIsSuggesting(true);
    try {
      const unassignedShifts = shifts.filter(s => !s.userId);
      const suggestions = await suggestShifts(employees, unassignedShifts);
      
      for (const suggestion of suggestions) {
        const shift = shifts.find(s => s.title === suggestion.title && !s.userId);
        if (shift) {
          await updateDoc(doc(db, 'shifts', shift.id), {
            userId: suggestion.userId,
            status: 'pending'
          });
        }
      }
    } catch (error) {
      console.error("AI Suggestion Error:", error);
    } finally {
      setIsSuggesting(false);
    }
  };

  const toggleShiftStatus = async (shift: Shift) => {
    if (!appUser) return;
    let newStatus: 'pending' | 'confirmed' | 'completed' = shift.status;
    
    if (appUser.role === 'admin') {
      if (shift.status === 'pending') newStatus = 'confirmed';
      else if (shift.status === 'confirmed') newStatus = 'completed';
    } else if (appUser.uid === shift.userId) {
      if (shift.status === 'pending') newStatus = 'confirmed';
    }

    try {
      await updateDoc(doc(db, 'shifts', shift.id), { status: newStatus });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `shifts/${shift.id}`);
    }
  };

  const deleteShift = async (id: string) => {
    if (appUser?.role !== 'admin') return;
    try {
      await deleteDoc(doc(db, 'shifts', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `shifts/${id}`);
    }
  };

  // Advanced Stats Calculation
  useEffect(() => {
    if (shifts.length === 0) return;
    
    const empStats: Record<string, any> = {};
    employees.forEach(e => {
      empStats[e.uid] = { name: e.displayName, fri: 0, sat: 0, tue: 0, total: 0 };
    });

    shifts.forEach(s => {
      if (s.userId && empStats[s.userId] && s.status === 'completed') {
        const day = s.startTime.toDate().getDay(); // 5 fri, 6 sat, 2 tue
        if (day === 5) empStats[s.userId].fri++;
        if (day === 6) empStats[s.userId].sat++;
        if (day === 2) empStats[s.userId].tue++;
        empStats[s.userId].total++;
      }
    });

    const statsArray = Object.values(empStats);
    setStats({
      fri: [...statsArray].sort((a, b) => b.fri - a.fri),
      sat: [...statsArray].sort((a, b) => b.sat - a.sat),
      tue: [...statsArray].sort((a, b) => b.tue - a.tue),
      total: [...statsArray].sort((a, b) => b.total - a.total),
    });
  }, [shifts, employees]);

  const handleSearch = () => {
    const results = shifts.filter(s => {
      const emp = employees.find(e => e.uid === s.userId);
      return emp && emp.displayName.includes(searchName);
    });
    setSearchResults(results);
  };

  const executeSwap = async (shift2: Shift) => {
    if (!swapSelection) return;
    
    const name1 = employees.find(e => e.uid === swapSelection.userId)?.displayName || 'Unknown';
    const name2 = employees.find(e => e.uid === shift2.userId)?.displayName || 'Unknown';

    // Conflict check
    const conflict = checkPairConflict(name1, name2);
    if (conflict) {
      alert(conflict);
      return;
    }

    try {
      const userId1 = swapSelection.userId;
      const userId2 = shift2.userId;

      await updateDoc(doc(db, 'shifts', swapSelection.id), { userId: userId2 });
      await updateDoc(doc(db, 'shifts', shift2.id), { userId: userId1 });
      
      alert(`✅ تم التبديل بنجاح بين ${name1} و ${name2}`);
      setSwapSelection(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'shifts/swap');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-[#3b82f6] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-[#111] rounded-3xl p-10 border border-[#222] shadow-2xl text-center relative overflow-hidden"
        >
          <div className="absolute -top-10 -right-10 text-[100px] font-black opacity-5 pointer-events-none italic">SHIFT</div>
          
          <div className="w-20 h-20 bg-[#E0FF4F] rounded-full flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(224,255,79,0.3)]">
            <BrainCircuit className="w-10 h-10 text-black" />
          </div>
          
          <h1 className="text-5xl font-black text-[#E0FF4F] mb-4 italic tracking-tighter uppercase leading-none">الشيفتات<br/>الذكية</h1>
          <p className="text-[#a3a3a3] mb-10 text-lg font-light leading-relaxed">نظام متطور لجدولة وإدارة دوريات العمل بالذكاء الاصطناعي</p>
          
          <button 
            onClick={signIn}
            className="w-full bg-[#E0FF4F] hover:scale-[1.02] active:scale-[0.98] text-black font-black py-4 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 group uppercase tracking-widest italic"
          >
            <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            تسجيل الدخول
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f0f0f0] flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#111] border-r border-[#222] hidden md:flex flex-col p-8 sticky top-0 h-screen">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 bg-[#E0FF4F] rounded-full"></div>
          <span className="text-2xl font-black text-white tracking-tighter uppercase italic">SmartShift</span>
        </div>

        <nav className="flex-1 space-y-4">
          <button 
            onClick={() => setActiveTab('calendar')}
            className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-bold uppercase text-sm tracking-widest ${activeTab === 'calendar' ? 'bg-[#E0FF4F] text-black italic' : 'hover:bg-white/5 text-[#a3a3a3] opacity-60'}`}
          >
            <CalendarDays className="w-5 h-5" />
            <span>الجدول</span>
          </button>

          <button 
            onClick={() => setActiveTab('search')}
            className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-bold uppercase text-sm tracking-widest ${activeTab === 'search' ? 'bg-[#E0FF4F] text-black italic' : 'hover:bg-white/5 text-[#a3a3a3] opacity-60'}`}
          >
            <Calendar className="w-5 h-5" />
            <span>السجلات</span>
          </button>

          <button 
            onClick={() => setActiveTab('stats')}
            className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-bold uppercase text-sm tracking-widest ${activeTab === 'stats' ? 'bg-[#E0FF4F] text-black italic' : 'hover:bg-white/5 text-[#a3a3a3] opacity-60'}`}
          >
            <Users className="w-5 h-5" />
            <span>الإحصائيات</span>
          </button>
          
          {appUser?.role === 'admin' && (
            <button 
              onClick={() => setActiveTab('admin')}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-bold uppercase text-sm tracking-widest ${activeTab === 'admin' ? 'bg-[#E0FF4F] text-black italic' : 'hover:bg-white/5 text-[#a3a3a3] opacity-60'}`}
            >
              <Users className="w-5 h-5" />
              <span>الإدارة</span>
            </button>
          )}

          <button 
            onClick={() => setActiveTab('profile')}
            className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-bold uppercase text-sm tracking-widest ${activeTab === 'profile' ? 'bg-[#E0FF4F] text-black italic' : 'hover:bg-white/5 text-[#a3a3a3] opacity-60'}`}
          >
            <UserIcon className="w-5 h-5" />
            <span>الملف</span>
          </button>
        </nav>

        <button 
          onClick={logOut}
          className="flex items-center gap-4 px-4 py-3 rounded-xl text-red-500 hover:bg-red-500/10 transition-all mt-auto font-bold uppercase text-xs tracking-widest"
        >
          <LogOut className="w-5 h-5" />
          <span>خروج</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 md:p-12 relative" dir="rtl">
        <div className="absolute top-20 right-10 text-[200px] font-black opacity-[0.02] pointer-events-none italic select-none">SHIFTS</div>
        
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16 relative z-10">
          <div>
            <h2 className="text-[80px] leading-[0.9] font-black text-[#E0FF4F] mb-4 italic tracking-tighter">
              {activeTab === 'calendar' ? 'خارطة الشيفتات' : activeTab === 'admin' ? 'مركز التحكم' : activeTab === 'search' ? 'سجلات الموظفين' : activeTab === 'stats' ? 'لوحة الشرف' : 'إعدادات الحساب'}
            </h2>
            <p className="text-xl text-gray-500 font-light max-w-lg">مرحباً، {appUser?.displayName} — {appUser?.role === 'admin' ? 'مدير النظام' : 'عضو الفريق'}</p>
          </div>

          {activeTab === 'calendar' && appUser?.role === 'admin' && (
            <div className="flex items-center gap-4">
              <button 
                onClick={handleSmartSuggest}
                disabled={isSuggesting}
                className="bg-transparent border-2 border-[#E0FF4F] text-[#E0FF4F] px-8 py-4 rounded-xl flex items-center gap-3 hover:bg-[#E0FF4F] hover:text-black transition-all disabled:opacity-50 font-black uppercase italic text-sm tracking-widest"
              >
                {isSuggesting ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><BrainCircuit className="w-5 h-5" /></motion.div>
                ) : (
                  <BrainCircuit className="w-5 h-5" />
                )}
                توزيع ذكي
              </button>
              <button 
                onClick={handleAddShift}
                className="bg-[#E0FF4F] text-black px-8 py-4 rounded-xl flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-[#E0FF4F]/10 font-black uppercase italic text-sm tracking-widest"
              >
                <Plus className="w-5 h-5" />
                إضافة شيفت
              </button>
            </div>
          )}
        </header>

        <section className="relative z-10">
          {activeTab === 'calendar' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
              <AnimatePresence mode="popLayout">
                {shifts.map((shift) => (
                  <motion.div
                    key={shift.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`bg-black border border-[#222] rounded-2xl p-8 hover:rotate-1 transition-transform duration-300 relative group ${swapSelection?.id === shift.id ? 'ring-2 ring-[#E0FF4F]' : ''}`}
                  >
                    <div className="flex justify-between items-center mb-10">
                      <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        shift.status === 'completed' ? 'bg-green-500 text-black' : 
                        shift.status === 'confirmed' ? 'bg-[#E0FF4F] text-black' : 
                        'bg-white/10 text-white opacity-60'
                      }`}>
                        {shift.status === 'completed' ? 'مكتمل' : shift.status === 'confirmed' ? 'مؤكد' : 'منتظر'}
                      </span>
                      <div className="flex gap-2">
                        {appUser?.role === 'admin' && !swapSelection && (
                          <button 
                            onClick={() => setSwapSelection(shift)}
                            className="text-gray-500 hover:text-[#E0FF4F] transition-all"
                            title="تبديل"
                          >
                            <Calendar className="w-5 h-5" />
                          </button>
                        )}
                        {appUser?.role === 'admin' && (
                          <button 
                            onClick={() => deleteShift(shift.id)}
                            className="text-gray-500 hover:text-red-500 transition-all"
                            title="حذف"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="text-3xl font-black text-white mb-8 italic tracking-tight">{shift.title}</h3>
                    
                    <div className="space-y-4 mb-10">
                      {/* ... (clock, calendar content) */}
                      <div className="flex items-center gap-4 text-gray-500 bg-[#111] p-4 rounded-xl border border-[#222]">
                        <Clock className="w-5 h-5 text-[#E0FF4F]" />
                        <span className="text-sm font-bold opacity-80 uppercase tracking-tighter">
                          {shift.startTime.toDate().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} - 
                          {shift.endTime.toDate().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-gray-500 bg-[#111] p-4 rounded-xl border border-[#222]">
                        <CalendarDays className="w-5 h-5 text-[#E0FF4F]" />
                        <span className="text-sm font-bold opacity-80">{shift.startTime.toDate().toLocaleDateString('ar-EG')}</span>
                      </div>
                      <div className="flex items-center gap-4 bg-[#111] p-4 rounded-xl border border-[#222]">
                        <div className="w-8 h-8 rounded-full bg-[#222] flex items-center justify-center">
                          <UserIcon className="w-4 h-4 text-gray-400" />
                        </div>
                        <span className="text-sm font-black text-white">
                          {employees.find(e => e.uid === shift.userId)?.displayName || 'غير معين بعد'}
                        </span>
                      </div>
                    </div>

                    {swapSelection && swapSelection.id !== shift.id ? (
                      <button 
                        onClick={() => executeSwap(shift)}
                        className="w-full py-4 rounded-xl border-2 border-[#E0FF4F] bg-transparent text-[#E0FF4F] font-black uppercase italic tracking-widest text-xs hover:bg-[#E0FF4F] hover:text-black transition-all"
                      >
                        تبديل مع هذا الشيفت
                      </button>
                    ) : (
                      <button 
                        onClick={() => toggleShiftStatus(shift)}
                        disabled={shift.status === 'completed' && appUser?.role !== 'admin'}
                        className={`w-full py-4 rounded-xl border-2 font-black uppercase italic tracking-widest text-xs transition-all ${
                          shift.status === 'completed' 
                            ? 'border-[#222] text-gray-600 cursor-not-allowed opacity-50' 
                            : 'border-[#E0FF4F] bg-[#E0FF4F] text-black hover:scale-[1.02]'
                        }`}
                      >
                        {shift.status === 'completed' ? 'تمت المهمة' : appUser?.role === 'admin' ? 'تحديث الحالة' : 'تأكيد الحضور'}
                      </button>
                    )}
                    
                    {swapSelection?.id === shift.id && (
                      <button 
                        onClick={() => setSwapSelection(null)}
                        className="w-full mt-2 text-[10px] text-gray-500 hover:text-white uppercase font-bold tracking-widest"
                      >
                        إلغاء التبديل
                      </button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {activeTab === 'search' && (
            <div className="space-y-8">
              <div className="bg-[#111] p-8 rounded-3xl border border-[#222] flex gap-4">
                <input 
                  type="text" 
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  placeholder="ابحث عن اسم الموظف..."
                  className="flex-1 bg-black border border-[#333] rounded-xl px-6 font-bold text-white outline-none focus:border-[#E0FF4F] transition-all"
                />
                <button 
                  onClick={handleSearch}
                  className="bg-[#E0FF4F] text-black px-10 py-4 rounded-xl font-black uppercase italic text-sm tracking-widest"
                >
                  بحث
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {searchResults.map(s => (
                  <div key={s.id} className="bg-black border border-[#222] p-6 rounded-2xl">
                    <h4 className="text-xl font-black text-white mb-2">{employees.find(e => e.uid === s.userId)?.displayName}</h4>
                    <p className="text-[#E0FF4F] text-xs font-bold mb-4">{s.title}</p>
                    <div className="text-gray-500 text-sm space-y-1">
                      <p>{s.startTime.toDate().toLocaleDateString('ar-EG')}</p>
                      <p className="font-bold text-white/50">{s.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {[
                { title: 'ترتيب الجمعة', key: 'fri', icon: <Calendar className="w-5 h-5" /> },
                { title: 'ترتيب السبت', key: 'sat', icon: <Calendar className="w-5 h-5" /> },
                { title: 'ترتيب الثلاثاء', key: 'tue', icon: <Calendar className="w-5 h-5" /> },
                { title: 'الترتيب الإجمالي', key: 'total', icon: <CheckCircle className="w-5 h-5" /> }
              ].map(cat => (
                <div key={cat.key} className="bg-[#111] border border-[#222] rounded-3xl p-8">
                  <div className="flex justify-between items-center mb-8 border-b border-[#222] pb-6">
                    <h4 className="text-2xl font-black text-white italic flex items-center gap-3">
                      {cat.icon}
                      {cat.title}
                    </h4>
                    <span className="text-[10px] font-black uppercase text-[#E0FF4F] tracking-widest">الأول: {stats[cat.key][0]?.name || '...'}</span>
                  </div>
                  <div className="space-y-4">
                    {stats[cat.key].map((item: any, idx: number) => (
                      <div key={item.name} className="flex justify-between items-center p-4 bg-black/50 border border-[#222] rounded-xl">
                        <div className="flex items-center gap-4">
                          <span className="w-6 h-6 rounded-full bg-[#222] flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                          <span className="font-bold text-white/80">{item.name}</span>
                        </div>
                        <span className="text-[#E0FF4F] font-black italic">{item[cat.key]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'admin' && (
            <div className="bg-[#111] border border-[#222] rounded-2xl overflow-hidden shadow-2xl">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-black/50">
                    <th className="px-8 py-6 font-black uppercase text-xs tracking-widest text-[#E0FF4F] border-b border-[#222]">الموظف</th>
                    <th className="px-8 py-6 font-black uppercase text-xs tracking-widest text-[#E0FF4F] border-b border-[#222]">البريد</th>
                    <th className="px-8 py-6 font-black uppercase text-xs tracking-widest text-[#E0FF4F] border-b border-[#222]">الرتبة</th>
                    <th className="px-8 py-6 font-black uppercase text-xs tracking-widest text-[#E0FF4F] border-b border-[#222]">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222]">
                  {employees.map((emp) => (
                    <tr key={emp.uid} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-8 py-6 font-bold">{emp.displayName}</td>
                      <td className="px-8 py-6 text-gray-500 text-sm">{emp.email}</td>
                      <td className="px-8 py-6">
                        <span className="px-3 py-1 rounded bg-[#E0FF4F]/10 text-[#E0FF4F] text-[10px] font-black uppercase italic tracking-widest">{emp.role}</span>
                      </td>
                      <td className="px-8 py-6">
                        <button className="text-white hover:text-[#E0FF4F] transition-colors font-black uppercase text-[10px] tracking-widest italic">عرض التفاصيل</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="max-w-3xl bg-[#111] border-2 border-[#222] rounded-3xl p-12 relative overflow-hidden">
              <div className="absolute -bottom-10 -right-10 text-[120px] font-black opacity-[0.03] italic uppercase tracking-tighter">Profile</div>
              
              <div className="flex items-center gap-10 mb-16">
                <div className="w-32 h-32 bg-gradient-to-tr from-[#E0FF4F] to-white rounded-full flex items-center justify-center text-4xl font-black text-black shadow-2xl shadow-[#E0FF4F]/20 italic">
                  {appUser?.displayName?.[0] || 'U'}
                </div>
                <div>
                  <h3 className="text-4xl font-black text-white mb-2 italic tracking-tighter uppercase">{appUser?.displayName}</h3>
                  <p className="text-xl text-gray-500 font-light">{appUser?.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-500">الاسم التعريفي</label>
                  <div className="w-full bg-black border border-[#333] rounded-xl px-6 py-4 text-white font-bold">
                    {appUser?.displayName}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-500">المستوى الوظيفي</label>
                  <div className="w-full bg-black border border-[#333] rounded-xl px-6 py-4 text-[#E0FF4F] font-black italic uppercase tracking-widest">
                    {appUser?.role === 'admin' ? 'System Administrator' : 'Crew Member'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
