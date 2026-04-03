import React, { useState, useEffect } from 'react';
import { 
  Calendar, MapPin, User, Phone, Mail, FileText, 
  CheckCircle, Clock, AlertCircle, Send, Key, 
  Truck, ClipboardList, RefreshCw, Plus, ArrowRight, Link as LinkIcon, Trash2,
  Settings, Edit2, X, Lock, LogOut
} from 'lucide-react';

// --- FIREBASE IMPORTS & SETUP ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, getDoc, deleteDoc } from 'firebase/firestore';

// YOUR LIVE FIREBASE CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyCjVyl8oc5ZGbq2FlrBHO02MLlxqIkSyOw",
  authDomain: "trust-inspection-coordinator.firebaseapp.com",
  projectId: "trust-inspection-coordinator",
  storageBucket: "trust-inspection-coordinator.firebasestorage.app",
  messagingSenderId: "836672752670",
  appId: "1:836672752670:web:9859d8dc9960c0478b320f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'trust-inspection-coordinator';

// YOUR MAKE.COM WEBHOOK URL
const MAKE_WEBHOOK_URL = "https://hook.us2.make.com/dio2kjm5dmlcydacspdfclfuh4g73dvf";

// --- DEFAULT MOCK DATA (For Initial Seeding Only) ---
const DEFAULT_VENDOR_CONFIG = [
  { match: 'Rix Termite', type: 'Termite', vendor: 'Rix Pest Control', visits: 1, phone: '555-0101', email: 'dispatch@rix.com' },
  { match: 'Kaw Valley', type: 'Termite', vendor: 'Kaw Valley Exterminator', visits: 1, phone: '555-0102', email: 'scheduling@kawvalley.com' },
  { match: 'Howell Healthy Homes', type: 'Radon', vendor: 'Howell Healthy Homes', visits: 2, phone: '555-0103', email: 'radon@howell.com' },
  { match: 'D&I PLumbing and HVAC', price: 125, type: 'Radon', vendor: 'D&I Plumbing and HVAC', visits: 2, phone: '555-0104', email: 'hvac@di.com' },
  { match: 'D&I PLumbing and HVAC', price: 300, type: 'Sewer', vendor: 'D&I Plumbing and HVAC', visits: 1, phone: '555-0104', email: 'plumbing@di.com' },
  { match: 'Reid Plumbing', type: 'Sewer', vendor: 'Reid Plumbing', visits: 1, phone: '555-0105', email: 'dispatch@reid.com' },
  { match: 'Trust Inspection Sewer', type: 'Sewer', vendor: 'Trust Inspection', visits: 1, phone: 'Internal', email: 'Internal' },
];

const SAMPLE_GCAL_TEXT = `Jessica Mills - 1820 Browning Ave
Thursday, Apr 2 • 12:00 – 1:15 PM

1820 Browning Ave, Manhattan, KS 66502

Created by Todd Thompson
termn8u2007@gmail.com

Buyer - Jessica Mills (JessicaMills518)
Mobile: 8888888888
jekam9728@gmail.com

Buyer's Agent - NA
NA
Mobile: NA
NA

Services (Total: $975.00)
1Home Inspection up to 2500 sq. ft. $450.00
1D&I PLumbing and HVAC $300.00
1Howell Healthy Homes $125.00
1Rix Termite $100.00

Report ID: 20260402-1820-Browning-Ave
Referral: Online Appointment Request
Utilities On: None
Who present at inspection: Inspector`;

export default function App() {
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState({ path: 'dashboard', params: {} });
  
  // Auth State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Dashboard State
  const [jobs, setJobs] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rawInput, setRawInput] = useState('');
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [jobToDelete, setJobToDelete] = useState(null);

  // Vendor Manager State
  const [showVendorManager, setShowVendorManager] = useState(false);
  const [vendorForm, setVendorForm] = useState(null);

  // Portal State
  const [portalJob, setPortalJob] = useState(null);
  const [agentFormMode, setAgentFormMode] = useState('provideCode');
  const [vendorWantsCalendar, setVendorWantsCalendar] = useState(false);
  const [vendorEmail, setVendorEmail] = useState('');
  const [portalSuccess, setPortalSuccess] = useState(false);

  const selectedJob = jobs.find(j => j.id === selectedJobId) || null;

  // --- ROUTING ENGINE ---
  useEffect(() => {
    const handleHashChange = () => {
      setPortalSuccess(false);
      const hash = window.location.hash.replace('#', '');
      if (!hash) {
        setRoute({ path: 'dashboard', params: {} });
        return;
      }
      
      const parts = hash.split('/');
      if (parts[0] === 'vendor' && parts[1] && parts[2]) {
        setRoute({ path: 'vendor', params: { jobId: parts[1], serviceId: parts[2] } });
      } else if (parts[0] === 'agent' && parts[1]) {
        setRoute({ path: 'agent', params: { jobId: parts[1] } });
      } else {
        setRoute({ path: 'dashboard', params: {} });
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // --- FIREBASE INITIALIZATION ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Authentication failed:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- DATA FETCHING (DASHBOARD vs PORTALS) ---
  useEffect(() => {
    if (!user) return;
    
    if (route.path === 'vendor' || route.path === 'agent') {
      const fetchPortalJob = async () => {
        try {
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'jobs', route.params.jobId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setPortalJob(data);
            if (route.path === 'vendor') {
              const svc = data.services.find(s => s.id === route.params.serviceId);
              if (svc && svc.email) setVendorEmail(svc.email);
            }
          }
        } catch (err) {
          console.error("Error fetching portal job:", err);
        }
      };
      fetchPortalJob();
      return; 
    }

    if (user.isAnonymous) return;

    // Fetch Jobs
    const jobsRef = collection(db, 'artifacts', appId, 'public', 'data', 'jobs');
    const unsubJobs = onSnapshot(jobsRef, (snapshot) => {
      const loadedJobs = [];
      snapshot.forEach(doc => loadedJobs.push(doc.data()));
      loadedJobs.sort((a, b) => b.createdAt - a.createdAt);
      setJobs(loadedJobs);
    }, (error) => {
      console.error("Error fetching jobs:", error);
    });

    // Fetch Vendors
    const vendorsRef = collection(db, 'artifacts', appId, 'public', 'data', 'vendors');
    const unsubVendors = onSnapshot(vendorsRef, (snapshot) => {
      const loadedVendors = [];
      snapshot.forEach(doc => loadedVendors.push(doc.data()));
      loadedVendors.sort((a, b) => a.vendor.localeCompare(b.vendor));
      setVendors(loadedVendors);
    }, (error) => {
      console.error("Error fetching vendors:", error);
    });

    return () => {
      unsubJobs();
      unsubVendors();
    };
  }, [user, route.path, route.params.jobId]);

  // --- HELPERS ---
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (err) {
      setLoginError("Invalid email or password. Please check your Firebase console users.");
    }
  };

  const handleAdminLogout = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
  };

  const formatDateFriendly = (dateStr) => {
    if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
    const [y, m, d] = dateStr.split('-');
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const getRequiredAccessDates = (job) => {
    if (!job) return [];
    const dates = new Set();
    if (job.mainDate) dates.add(job.mainDate);
    
    job.services.forEach(s => {
      if (s.status === 'scheduled') {
        if (s.schedule.date1) dates.add(s.schedule.date1);
        if (s.visits === 2 && s.schedule.date2) dates.add(s.schedule.date2);
      }
    });
    return Array.from(dates).sort();
  };

  const generateMagicLink = (type, jobId, serviceId = null) => {
    const baseUrl = window.location.href.split('#')[0];
    if (type === 'agent') return `${baseUrl}#agent/${jobId}`;
    if (type === 'vendor') return `${baseUrl}#vendor/${jobId}/${serviceId}`;
    return baseUrl;
  };

  // WEBHOOK TRIGGER FUNCTION
  const sendWebhook = async (payload) => {
    try {
      await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error("Webhook failed to send:", err);
    }
  };

  // --- VENDOR MANAGEMENT MUTATIONS ---
  const handleSeedVendors = async () => {
    for (const v of DEFAULT_VENDOR_CONFIG) {
      const id = crypto.randomUUID();
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'vendors', id), { ...v, id });
    }
  };

  const handleSaveVendor = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const vendorData = {
      id: vendorForm.id || crypto.randomUUID(),
      match: fd.get('match'),
      vendor: fd.get('vendor'),
      type: fd.get('type'),
      phone: fd.get('phone'),
      email: fd.get('email'),
      visits: parseInt(fd.get('visits') || 1),
      price: fd.get('price') ? parseFloat(fd.get('price')) : null
    };

    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'vendors', vendorData.id), vendorData);
      setVendorForm(null); 
    } catch (err) {
      console.error("Error saving vendor:", err);
    }
  };

  const handleDeleteVendor = async (id) => {
    if (!window.confirm("Are you sure you want to delete this vendor?")) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'vendors', id));
    } catch (err) {
      console.error("Error deleting vendor:", err);
    }
  };

  // --- PARSING & DATABASE MUTATIONS ---
  const handleParse = async () => {
    if (!rawInput.trim() || !user) return;
    
    if (vendors.length === 0) {
      alert("No vendors found in the database. Please open 'Manage Vendors' and configure them before parsing a job.");
      return;
    }

    const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
    const jobId = crypto.randomUUID();
    let job = {
      id: jobId,
      createdBy: user.uid,
      createdAt: Date.now(),
      title: lines[0],
      address: '',
      datetime: lines[1],
      mainDate: '', 
      reportId: '',
      buyer: { name: '', email: '', phone: '' },
      buyerAgent: { name: '', email: '', phone: '' },
      services: [],
      status: 'new', 
      access: {
        status: 'pending', 
        occupancy: '', // New tracking field
        codes: {}, 
        instructions: '',
        listingAgent: { name: '', phone: '', email: '' }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes(', KS') || line.includes(', MO')) {
        job.address = line;
      }
      
      if (line.startsWith('Report ID:')) {
        const rawId = line.replace('Report ID:', '').trim();
        job.reportId = rawId;
        const dateMatch = rawId.match(/^(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          job.mainDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        } else {
          job.mainDate = lines[1].split('•')[0].trim();
        }
      }

      if (line.startsWith('Buyer -')) {
        job.buyer.name = line.replace('Buyer -', '').split('(')[0].trim();
        if (lines[i+1]?.startsWith('Mobile:')) job.buyer.phone = lines[i+1].replace('Mobile:', '').trim();
        if (lines[i+2]?.includes('@')) job.buyer.email = lines[i+2].trim();
      }

      if (line.startsWith("Buyer's Agent -")) {
        job.buyerAgent.name = line.replace("Buyer's Agent -", '').split('(')[0].trim();
        let j = i + 1;
        while(j < i + 4 && j < lines.length) {
          if (lines[j].startsWith('Mobile:')) job.buyerAgent.phone = lines[j].replace('Mobile:', '').trim();
          if (lines[j].includes('@') && !lines[j].includes('(')) job.buyerAgent.email = lines[j].trim();
          j++;
        }
      }

      if (line.startsWith('Services (Total:')) {
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith('Report ID:')) {
          const serviceLine = lines[j];
          if (!serviceLine.includes('Home Inspection up to')) {
            let priceStr = serviceLine.match(/\$([0-9.]+)/)?.[1] || "0";
            let price = parseFloat(priceStr);
            
            const matchedVendor = vendors.find(v => {
              const nameMatch = serviceLine.includes(v.match);
              if (v.price) return nameMatch && price === parseFloat(v.price);
              return nameMatch;
            });

            if (matchedVendor) {
              job.services.push({
                id: crypto.randomUUID(),
                ...matchedVendor,
                rawText: serviceLine,
                status: 'pending',
                schedule: { 
                  date1: null, timeWindow1: null, 
                  date2: null, timeWindow2: null, 
                  requestedCalendar: false, calendarEmail: '' 
                }
              });
            }
          }
          j++;
        }
      }
    }

    // FSBO / No Buyer's Agent Fallback
    const agentNameRaw = job.buyerAgent.name.toLowerCase();
    if (!agentNameRaw || agentNameRaw === 'na' || agentNameRaw === 'n/a' || agentNameRaw === 'none') {
      job.buyerAgent = { ...job.buyer }; // Copy buyer info to act as the coordinating agent
    }

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'jobs', jobId);
      await setDoc(docRef, job);
      setRawInput('');
      setSelectedJobId(jobId);

      // Trigger Webhook to Make.com
      sendWebhook({
        event: 'job_created',
        job: job,
        agentLink: generateMagicLink('agent', job.id),
        vendorLinks: job.services.map(s => ({
          vendorName: s.vendor,
          email: s.email,
          phone: s.phone,
          type: s.type,
          link: generateMagicLink('vendor', job.id, s.id)
        }))
      });

    } catch (err) {
      console.error("Error saving job:", err);
    }
  };

  const confirmDeleteJob = async () => {
    if (!jobToDelete || !user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'jobs', jobToDelete));
      if (selectedJobId === jobToDelete) setSelectedJobId(null);
      setJobToDelete(null);
    } catch (err) {
      console.error("Error deleting job:", err);
    }
  };

  const submitVendorSchedule = async (e) => {
    e.preventDefault();
    if (!portalJob || !user) return;

    const fd = new FormData(e.target);
    const scheduleData = {
      date1: fd.get('date1'),
      timeWindow1: fd.get('timeWindow1'),
      date2: fd.get('date2') || null,
      timeWindow2: fd.get('timeWindow2') || null,
      requestedCalendar: vendorWantsCalendar,
      calendarEmail: vendorWantsCalendar ? fd.get('calendarEmail') : ''
    };

    const updatedJob = {
      ...portalJob,
      services: portalJob.services.map(s => s.id === route.params.serviceId ? { ...s, status: 'scheduled', schedule: scheduleData } : s)
    };

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'jobs', portalJob.id);
      await setDoc(docRef, updatedJob);
      setPortalSuccess(true);

      const allScheduled = updatedJob.services.every(s => s.status === 'scheduled');

      // Trigger Webhook to Make.com
      sendWebhook({
        event: 'vendor_scheduled',
        jobId: portalJob.id,
        address: portalJob.address,
        vendorService: updatedJob.services.find(s => s.id === route.params.serviceId),
        allScheduled: allScheduled,
        agentEmail: portalJob.buyerAgent.email, 
        agentLink: generateMagicLink('agent', portalJob.id)
      });

    } catch (err) {
      console.error("Error updating service schedule:", err);
    }
  };

  const submitAgentAccess = async (e) => {
    e.preventDefault();
    if (!portalJob || !user) return;

    const fd = new FormData(e.target);
    let updatedJob = { ...portalJob };
    let formattedAccessText = '';
    const occupancy = fd.get('occupancy') || '';
    
    // Inject Occupancy to the formatted text for Make.com to grab
    formattedAccessText += `<strong>Property Status:</strong> ${occupancy}<br><br>`;

    if (agentFormMode === 'provideCode') {
      const codes = {};
      getRequiredAccessDates(portalJob).forEach(date => {
        codes[date] = fd.get(`code_${date}`);
        formattedAccessText += `<strong>${formatDateFriendly(date)}:</strong> ${codes[date]}<br>`;
      });
      if (fd.get('notes')) {
        formattedAccessText += `<br><strong>Notes:</strong><br>${fd.get('notes')}`;
      }
      updatedJob.access = { 
        ...updatedJob.access, 
        status: 'provided', 
        occupancy: occupancy,
        codes, 
        instructions: fd.get('notes') 
      };
    } else {
      updatedJob.access = { 
        ...updatedJob.access, 
        status: 'waiting_on_listing_agent', 
        occupancy: occupancy,
        listingAgent: { name: fd.get('la_name'), phone: fd.get('la_phone'), email: fd.get('la_email') } 
      };
    }

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'jobs', portalJob.id);
      await setDoc(docRef, updatedJob);
      setPortalSuccess(true);

      // Trigger Webhook to Make.com
      sendWebhook({
        event: 'agent_access_submitted',
        jobId: portalJob.id,
        address: portalJob.address,
        accessDetails: updatedJob.access,
        formattedAccessText: formattedAccessText,
        vendorContacts: updatedJob.services.map(s => ({
          vendorName: s.vendor,
          type: s.type, // Added to build event title
          email: s.email,
          phone: s.phone,
          wantsCalendar: s.schedule?.requestedCalendar,
          calendarEmail: s.schedule?.calendarEmail,
          visits: s.visits,
          date1: s.schedule?.date1, // Added to set calendar date
          timeWindow1: s.schedule?.timeWindow1,
          date2: s.schedule?.date2,
          timeWindow2: s.schedule?.timeWindow2
        }))
      });

    } catch (err) {
      console.error("Error updating access info:", err);
    }
  };

  // --- RENDER HELPERS ---
  const getJobStatus = (job) => {
    const allServicesScheduled = job.services.every(s => s.status === 'scheduled');
    const hasAccessCode = job.access.status === 'provided';
    if (allServicesScheduled && hasAccessCode) return 'Ready';
    if (allServicesScheduled || hasAccessCode || job.access.status === 'waiting_on_listing_agent') return 'Partial';
    return 'Pending';
  };

  const generateGCalSyncText = (job) => {
    let text = `\n\n=== 🚧 VENDOR & ACCESS STATUS ===\n`;
    
    if (job.access.occupancy) {
      text += `Property Status: ${job.access.occupancy.toUpperCase()}\n`;
    }

    if (job.access.status === 'provided') {
      text += `Access Codes:\n`;
      Object.entries(job.access.codes).forEach(([date, code]) => {
        text += `  - ${formatDateFriendly(date)}: ${code}\n`;
      });
      if (job.access.instructions) text += `Notes: ${job.access.instructions}\n`;
    } else if (job.access.status === 'waiting_on_listing_agent') {
      text += `Access: REQUESTED FROM LISTING AGENT/SELLER (${job.access.listingAgent.name})\n`;
    } else {
      text += `Access: PENDING (Waiting on Buyer's Agent)\n`;
    }

    text += `-------------------------\n`;
    job.services.forEach(s => {
      text += `[${s.status === 'scheduled' ? '✓' : ' '}] ${s.type} (${s.vendor}): `;
      if (s.status === 'scheduled') {
        if (s.visits === 2) {
           text += `\n    Drop: ${s.schedule.date1} @ ${s.schedule.timeWindow1}\n    Pick: ${s.schedule.date2} @ ${s.schedule.timeWindow2}`;
        } else {
           text += `${s.schedule.date1} @ ${s.schedule.timeWindow1}`;
        }
      } else {
        text += `WAITING ON VENDOR`;
      }
      text += `\n`;
    });
    return text;
  };

  // --- LOGIN VIEW ---
  const renderLogin = () => (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-8 max-w-sm w-full border border-slate-200">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock size={32} />
        </div>
        <h2 className="text-2xl font-bold text-center text-slate-800 mb-6">Admin Login</h2>
        
        {loginError && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium mb-4 text-center border border-red-100">
            {loginError}
          </div>
        )}

        <form onSubmit={handleAdminLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
            <input 
              type="email" 
              required 
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800" 
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Password</label>
            <input 
              type="password" 
              required 
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800" 
            />
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-md mt-2">
            Access Dashboard
          </button>
        </form>
      </div>
    </div>
  );

  // --- DASHBOARD VIEW ---
  const renderDashboard = () => (
    <div className="flex flex-col h-screen font-sans bg-slate-100">
      <header className="bg-slate-900 text-white p-4 shadow-md flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <MapPin size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight hidden sm:block">Trust Inspection Coordinator</h1>
          <h1 className="text-xl font-bold tracking-tight sm:hidden">Coordinator</h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowVendorManager(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border border-slate-700"
          >
            <Settings size={16} /> <span className="hidden sm:inline">Vendors</span>
          </button>
          <button 
            onClick={handleAdminLogout}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border border-slate-700 text-red-400 hover:text-red-300"
            title="Log Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 flex-1 overflow-y-auto md:overflow-hidden">
        {/* Sidebar */}
        <div className="w-full md:w-[350px] lg:w-1/3 flex flex-col gap-4 shrink-0 md:overflow-hidden">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 shrink-0">
            <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-3">
              <Plus size={18} /> New Appointment
            </h2>
            <textarea 
              className="w-full h-32 p-3 text-sm border rounded-lg bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Paste GCal text here..."
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
            />
            <div className="flex gap-2 mt-3">
              <button 
                onClick={() => setRawInput(SAMPLE_GCAL_TEXT)}
                className="px-3 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg flex-1 font-medium transition-colors"
              >
                Load Sample
              </button>
              <button 
                onClick={handleParse}
                className="px-3 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex-1 font-medium transition-colors shadow-sm"
              >
                Create Job
              </button>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex-1 overflow-y-auto max-h-[40vh] md:max-h-full">
            <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-3">
              <ClipboardList size={18} /> Active Jobs
            </h2>
            {jobs.length === 0 ? (
              <div className="text-center text-slate-400 py-8 text-sm">No active jobs. Parse an event to begin.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {jobs.map(job => (
                  <div 
                    key={job.id} 
                    onClick={() => setSelectedJobId(job.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedJobId === job.id ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                  >
                    <div className="font-medium text-slate-800 text-sm truncate">{job.address.split(',')[0]}</div>
                    <div className="text-xs text-slate-500 mt-1 flex justify-between">
                      <span>{job.datetime.split('•')[0]}</span>
                      <span className={`px-2 py-0.5 rounded-full font-medium ${getJobStatus(job) === 'Ready' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {getJobStatus(job)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-[600px] md:min-h-0 overflow-hidden mt-4 md:mt-0 relative">
          {selectedJob ? (
            <div className="p-6 h-full overflow-y-auto">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-slate-800">{selectedJob.address.split(',')[0]}</h1>
                  <p className="text-slate-500 flex items-center gap-1 mt-1"><MapPin size={16}/> {selectedJob.address}</p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="text-slate-800 font-medium flex items-center justify-end gap-1"><Calendar size={16}/> {selectedJob.datetime}</div>
                  <div className="text-slate-500 text-sm mt-1 mb-3">ID: {selectedJob.reportId}</div>
                  
                  <button 
                    onClick={() => setJobToDelete(selectedJob.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} /> Delete Job
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6 mb-8">
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Client Info</h3>
                  <p className="font-medium text-slate-800 flex items-center gap-2"><User size={16}/> {selectedJob.buyer.name}</p>
                  <p className="text-slate-600 text-sm mt-1 flex items-center gap-2"><Phone size={14}/> {selectedJob.buyer.phone}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Coordinating Agent</h3>
                  <p className="font-medium text-slate-800 flex items-center gap-2"><User size={16}/> {selectedJob.buyerAgent.name}</p>
                  <p className="text-slate-600 text-sm mt-1 flex items-center gap-2"><Phone size={14}/> {selectedJob.buyerAgent.phone}</p>
                  
                  {selectedJob.access.status === 'provided' ? (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-md">
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-xs text-emerald-700 font-bold uppercase">Access Codes Received</div>
                        {selectedJob.access.occupancy && (
                          <div className="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded font-bold">{selectedJob.access.occupancy}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        {Object.entries(selectedJob.access.codes).map(([date, code]) => (
                          <div key={date} className="flex justify-between items-center text-sm border-b border-emerald-100 pb-1 last:border-0 last:pb-0">
                            <span className="text-emerald-800 font-medium">{formatDateFriendly(date)}</span>
                            <span className="font-mono font-bold text-emerald-900">{code}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : selectedJob.access.status === 'waiting_on_listing_agent' ? (
                    <div className="mt-3 p-2 bg-orange-50 border border-orange-100 rounded-md">
                      <div className="flex justify-between items-center mb-1">
                        <div className="text-xs text-orange-700 font-bold uppercase">Waiting on Agent/Seller</div>
                        {selectedJob.access.occupancy && (
                          <div className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded font-bold">{selectedJob.access.occupancy}</div>
                        )}
                      </div>
                      <div className="text-sm text-orange-900">{selectedJob.access.listingAgent.name} ({selectedJob.access.listingAgent.phone})</div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      {!selectedJob.services.every(s => s.status === 'scheduled') ? (
                        <div className="p-2 bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm font-medium rounded flex items-center gap-2">
                          <Clock size={16} /> Waiting for Vendors to schedule...
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button 
                            onClick={() => window.location.hash = `agent/${selectedJob.id}`}
                            className="flex-1 px-3 py-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 font-medium text-sm rounded transition-colors flex items-center justify-center gap-2"
                          >
                            Open Portal
                          </button>
                          <button 
                            onClick={() => navigator.clipboard.writeText(generateMagicLink('agent', selectedJob.id))}
                            className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 text-slate-600 rounded transition-colors"
                            title="Copy Link"
                          >
                            <LinkIcon size={16}/>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b pb-2">
                <Truck size={20} /> Vendor Coordination
              </h3>
              
              <div className="space-y-4 mb-8">
                {selectedJob.services.map(service => (
                  <div key={service.id} className="border border-slate-200 rounded-lg p-4 flex justify-between items-center">
                    <div>
                      <div className="font-bold text-slate-800">{service.type} Inspection</div>
                      <div className="text-sm text-slate-500">{service.vendor}</div>
                      
                      {service.status === 'scheduled' && (
                        <div className="mt-2 text-sm font-medium text-green-700 bg-green-50 px-3 py-1.5 rounded-md inline-block">
                          {service.visits === 2 ? (
                            <>
                              <div>Drop: {service.schedule.date1} @ {service.schedule.timeWindow1}</div>
                              <div>Pick: {service.schedule.date2} @ {service.schedule.timeWindow2}</div>
                            </>
                          ) : (
                            <div>Scheduled: {service.schedule.date1} @ {service.schedule.timeWindow1}</div>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {service.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => window.location.hash = `vendor/${selectedJob.id}/${service.id}`}
                          className="px-4 py-2 bg-blue-50 text-blue-700 font-medium text-sm rounded-lg hover:bg-blue-100 flex items-center gap-2 transition-colors"
                        >
                           Open Portal
                        </button>
                        <button 
                          onClick={() => navigator.clipboard.writeText(generateMagicLink('vendor', selectedJob.id, service.id))}
                          className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                          title="Copy Link"
                        >
                          <LinkIcon size={16}/>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-green-600 font-medium text-sm">
                        <CheckCircle size={18}/> Confirmed
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Generated GCal Text */}
              <div className="bg-slate-900 rounded-xl p-5 text-slate-300">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-medium text-white flex items-center gap-2">
                    <RefreshCw size={16} /> GCal Description Output
                  </h4>
                  <button 
                    onClick={() => navigator.clipboard.writeText(generateGCalSyncText(selectedJob))}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded transition-colors"
                  >
                    Copy to Clipboard
                  </button>
                </div>
                <pre className="text-xs whitespace-pre-wrap font-mono bg-slate-950 p-4 rounded-lg border border-slate-800">
                  {generateGCalSyncText(selectedJob)}
                </pre>
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <Calendar size={48} className="mb-4 opacity-20" />
              <p>Select a job from the left panel</p>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {jobToDelete && (
            <div className="absolute inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full border border-slate-200">
                <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <AlertCircle className="text-red-500" size={24} />
                  Delete Appointment?
                </h3>
                <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                  Are you sure you want to delete this job? This action cannot be undone and any vendors or agents will immediately lose access to their portals.
                </p>
                <div className="flex justify-end gap-3">
                  <button 
                    onClick={() => setJobToDelete(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmDeleteJob}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
                  >
                    Yes, Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Vendor Manager Modal */}
          {showVendorManager && (
            <div className="absolute inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="bg-slate-800 text-white p-4 flex justify-between items-center shrink-0">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Settings size={20} /> Vendor Database Configuration
                  </h2>
                  <button onClick={() => { setShowVendorManager(false); setVendorForm(null); }} className="text-slate-300 hover:text-white transition-colors">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1">
                  {vendorForm ? (
                    <form onSubmit={handleSaveVendor} className="space-y-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-slate-800">{vendorForm.id ? 'Edit Vendor' : 'Add New Vendor'}</h3>
                        <button type="button" onClick={() => setVendorForm(null)} className="text-sm text-blue-600 hover:underline">← Back to List</button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-50 p-4 rounded-lg md:col-span-2 border border-blue-100">
                          <label className="block text-sm font-bold text-blue-900 mb-1">GCal Match Text (Exact String)</label>
                          <p className="text-xs text-blue-700 mb-2">The exact text from Home Gauge/Google Calendar that triggers this vendor (e.g. "Rix Termite").</p>
                          <input type="text" name="match" defaultValue={vendorForm.match} required className="w-full border-blue-200 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>

                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Vendor/Company Name</label>
                          <input type="text" name="vendor" defaultValue={vendorForm.vendor} required className="w-full border border-slate-300 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Service Type</label>
                          <select name="type" defaultValue={vendorForm.type || 'Termite'} className="w-full border border-slate-300 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                            <option>Termite</option>
                            <option>Radon</option>
                            <option>Sewer</option>
                            <option>Mold</option>
                            <option>Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Phone Number</label>
                          <input type="text" name="phone" defaultValue={vendorForm.phone} required className="w-full border border-slate-300 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Email Address</label>
                          <input type="email" name="email" defaultValue={vendorForm.email} required className="w-full border border-slate-300 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Required Visits</label>
                          <select name="visits" defaultValue={vendorForm.visits || 1} className="w-full border border-slate-300 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                            <option value={1}>1 Visit (Standard)</option>
                            <option value={2}>2 Visits (Drop-off & Pick-up)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Price Filter (Optional)</label>
                          <p className="text-xs text-slate-500 mb-1">Only use if vendor offers multiple services under same name.</p>
                          <input type="number" step="0.01" name="price" defaultValue={vendorForm.price} placeholder="e.g. 125" className="w-full border border-slate-300 rounded p-2 outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end gap-3 border-t mt-6">
                        <button type="button" onClick={() => setVendorForm(null)} className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                        <button type="submit" className="px-6 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Save Vendor</button>
                      </div>
                    </form>
                  ) : (
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <p className="text-slate-600 text-sm flex-1">Configure the vendors that the system will automatically match when parsing calendar descriptions.</p>
                        <button 
                          onClick={() => setVendorForm({})}
                          className="px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-sm rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                        >
                          <Plus size={16} /> Add Vendor
                        </button>
                      </div>

                      {vendors.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                          <Truck className="mx-auto text-slate-400 mb-3" size={32} />
                          <h3 className="text-lg font-bold text-slate-700 mb-2">No Vendors Found</h3>
                          <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">Your live database is currently empty. You can manually add vendors, or load the initial testing configuration.</p>
                          <button 
                            onClick={handleSeedVendors}
                            className="px-4 py-2 bg-slate-800 text-white hover:bg-slate-700 font-bold rounded-lg transition-colors"
                          >
                            Load Default Configuration
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {vendors.map(v => (
                            <div key={v.id} className="border border-slate-200 p-4 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-blue-300 transition-colors">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="font-bold text-slate-800 text-lg">{v.vendor}</h3>
                                  <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded font-medium">{v.type} • {v.visits} Visit(s)</span>
                                </div>
                                <div className="text-sm text-slate-500 mt-1 flex gap-4">
                                  <span className="flex items-center gap-1"><Phone size={14}/> {v.phone}</span>
                                  <span className="flex items-center gap-1"><Mail size={14}/> {v.email}</span>
                                </div>
                                <div className="text-xs text-blue-600 mt-2 font-mono bg-blue-50 inline-block px-2 py-1 rounded">
                                  Match: "{v.match}" {v.price ? ` @ $${v.price}` : ''}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button onClick={() => setVendorForm(v)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <Edit2 size={18} />
                                </button>
                                <button onClick={() => handleDeleteVendor(v.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // --- VENDOR PORTAL VIEW ---
  const renderVendorPortal = () => {
    if (!portalJob) return <div className="p-8 text-center text-slate-500">Loading Job Details...</div>;
    
    const service = portalJob.services.find(s => s.id === route.params.serviceId);
    if (!service) return <div className="p-8 text-center text-red-500">Service not found.</div>;

    if (portalSuccess || service.status === 'scheduled') {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-8 max-w-md w-full text-center border border-slate-200">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Schedule Confirmed</h2>
            <p className="text-slate-600 mb-6">Thank you! Trust Inspection has been notified of your schedule for {portalJob.address.split(',')[0]}.</p>
          </div>
        </div>
      );
    }

    // Calculate 10-day scheduling window
    const today = new Date();
    const minDate = today.toISOString().split('T')[0];
    
    const maxDateObj = new Date(portalJob.createdAt);
    maxDateObj.setDate(maxDateObj.getDate() + 10);
    const maxDate = maxDateObj.toISOString().split('T')[0];

    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
        <div className="max-w-md mx-auto relative mt-6">
          <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-slate-200">
            <div className="bg-blue-600 p-6 text-white text-center">
              <h2 className="text-2xl font-bold">{service.vendor}</h2>
              <p className="opacity-80 text-sm mt-1">Scheduling Request via Trust Inspection</p>
            </div>
            
            <div className="p-6">
              <div className="mb-6 p-4 bg-blue-50 rounded-lg text-blue-900 border border-blue-100">
                <div className="font-bold mb-1">Service Needed: {service.type}</div>
                <div className="text-sm flex items-start gap-2 mt-2">
                  <MapPin size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
                  <span>{portalJob.address}</span>
                </div>
              </div>

              <form onSubmit={submitVendorSchedule}>
                {service.visits === 2 ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Drop-off Date</label>
                        <input type="date" name="date1" min={minDate} max={maxDate} required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Drop-off Time</label>
                        <select name="timeWindow1" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800 bg-white">
                          <option value="Morning (8am - 12pm)">Morning</option>
                          <option value="Afternoon (12pm - 4pm)">Afternoon</option>
                          <option value="Late Aft. (3pm - 6pm)">Late Aft.</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Pick-up Date</label>
                        <input type="date" name="date2" min={minDate} max={maxDate} required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Pick-up Time</label>
                        <select name="timeWindow2" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800 bg-white">
                          <option value="Morning (8am - 12pm)">Morning</option>
                          <option value="Afternoon (12pm - 4pm)">Afternoon</option>
                          <option value="Late Aft. (3pm - 6pm)">Late Aft.</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-4">
                      <label className="block text-sm font-bold text-slate-700 mb-1">Service Date</label>
                      <input type="date" name="date1" min={minDate} max={maxDate} required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800" />
                    </div>
                    <div className="mb-8">
                      <label className="block text-sm font-bold text-slate-700 mb-1">Time Window</label>
                      <select name="timeWindow1" className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-blue-500 outline-none text-slate-800 bg-white">
                        <option value="Morning (8am - 12pm)">Morning (8am - 12pm)</option>
                        <option value="Afternoon (12pm - 4pm)">Afternoon (12pm - 4pm)</option>
                        <option value="Late Aft. (3pm - 6pm)">Late Afternoon (3pm - 6pm)</option>
                      </select>
                    </div>
                  </>
                )}
                
                <div className="mb-8 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={vendorWantsCalendar}
                      onChange={(e) => setVendorWantsCalendar(e.target.checked)}
                      className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <span className="text-sm font-bold text-slate-700">Send me a Calendar Invite</span>
                  </label>
                  
                  {vendorWantsCalendar && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Calendar Email Address</label>
                      <input 
                        type="email" 
                        name="calendarEmail" 
                        value={vendorEmail}
                        onChange={(e) => setVendorEmail(e.target.value)}
                        placeholder="email@example.com" 
                        required={vendorWantsCalendar}
                        className="w-full border-slate-300 rounded-lg p-2 border focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white text-slate-800" 
                      />
                    </div>
                  )}
                </div>

                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-md text-lg">
                  Confirm Schedule
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- AGENT PORTAL VIEW ---
  const renderAgentPortal = () => {
    if (!portalJob) return <div className="p-8 text-center text-slate-500">Loading Access Details...</div>;
    
    if (portalSuccess || portalJob.access.status !== 'pending') {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-8 max-w-md w-full text-center border border-slate-200">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Information Received</h2>
            <p className="text-slate-600 mb-6">Thank you! Access coordination for {portalJob.address.split(',')[0]} has been updated.</p>
          </div>
        </div>
      );
    }

    const requiredDates = getRequiredAccessDates(portalJob);

    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
        <div className="max-w-md mx-auto relative mt-6">
          <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-slate-200">
            <div className="bg-emerald-600 p-6 text-white text-center">
              <h2 className="text-xl font-bold">Property Access Coordination</h2>
              <p className="opacity-80 text-sm mt-1">{portalJob.address.split(',')[0]}</p>
            </div>
            
            <div className="p-6">
              <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                Hi {portalJob.buyerAgent.name.split(' ')[0]}, we need access instructions for Todd's whole home inspection on <strong>{portalJob.datetime.split('•')[0]}</strong>, as well as for the scheduled vendors.
              </p>

              <div className="flex bg-slate-100 p-1 rounded-lg mb-6">
                <button 
                  onClick={() => setAgentFormMode('provideCode')}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${agentFormMode === 'provideCode' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  I'll provide access codes
                </button>
                <button 
                  onClick={() => setAgentFormMode('provideListingAgent')}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${agentFormMode === 'provideListingAgent' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Contact Listing Agent / Seller
                </button>
              </div>

              {agentFormMode === 'provideCode' ? (
                <form onSubmit={submitAgentAccess}>
                  <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <label className="block text-sm font-bold text-slate-700 mb-2">Is the property currently Vacant or Occupied?</label>
                    <select name="occupancy" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 bg-white">
                      <option value="">Select status...</option>
                      <option value="Vacant">Vacant</option>
                      <option value="Occupied">Occupied</option>
                    </select>
                  </div>

                  <div className="mb-4 space-y-3">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Access / Lockbox Codes</label>
                    {requiredDates.map(date => (
                      <div key={date} className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-200 shadow-sm">
                        <span className="text-xs font-bold text-slate-500 uppercase mb-1">{formatDateFriendly(date)}</span>
                        <input type="text" name={`code_${date}`} placeholder="e.g. 1234 or SUPRA" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-emerald-500 outline-none text-lg font-mono bg-white text-slate-800" />
                      </div>
                    ))}
                  </div>
                  
                  <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Special Instructions (Optional)</label>
                    <textarea name="notes" placeholder="e.g. Back door sticks, beware of dog in backyard" className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-emerald-500 outline-none h-24 bg-white text-slate-800"></textarea>
                  </div>

                  <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors shadow-md flex justify-center items-center gap-2 text-lg">
                    <CheckCircle size={20}/> Submit Access Info
                  </button>
                </form>
              ) : (
                <form onSubmit={submitAgentAccess}>
                  <div className="bg-orange-50 border border-orange-100 p-4 rounded-lg text-sm text-orange-800 mb-6 leading-relaxed">
                    We will automatically contact the Listing Agent or Seller to coordinate access for Todd and the vendors.
                  </div>
                  
                  <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <label className="block text-sm font-bold text-slate-700 mb-2">Is the property currently Vacant or Occupied?</label>
                    <select name="occupancy" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-orange-500 outline-none text-slate-800 bg-white">
                      <option value="">Select status...</option>
                      <option value="Vacant">Vacant</option>
                      <option value="Occupied">Occupied</option>
                    </select>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Listing Agent / Seller Name</label>
                    <input type="text" name="la_name" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-orange-500 outline-none bg-white text-slate-800" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Mobile Phone (For Texting)</label>
                    <input type="tel" name="la_phone" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-orange-500 outline-none bg-white text-slate-800" />
                  </div>
                  <div className="mb-8">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Email Address</label>
                    <input type="email" name="la_email" required className="w-full border-slate-300 rounded-lg p-3 border focus:ring-2 focus:ring-orange-500 outline-none bg-white text-slate-800" />
                  </div>
                  <button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-colors shadow-md flex justify-center items-center gap-2 text-lg">
                    <ArrowRight size={20}/> Forward Request
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- ROOT RENDERER ---
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-500 flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin" size={32} />
          <p className="font-medium">Connecting to Database...</p>
        </div>
      </div>
    );
  }

  if (route.path === 'vendor') return renderVendorPortal();
  if (route.path === 'agent') return renderAgentPortal();
  
  // Dashboard Route requires Admin Login
  if (!user || user.isAnonymous) return renderLogin();
  return renderDashboard();
}