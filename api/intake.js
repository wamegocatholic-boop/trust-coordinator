import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs } from 'firebase/firestore';

// Your live Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCjVyl8oc5ZGbq2FlrBHO02MLlxqIkSyOw",
  authDomain: "trust-inspection-coordinator.firebaseapp.com",
  projectId: "trust-inspection-coordinator",
  storageBucket: "trust-inspection-coordinator.firebasestorage.app",
  messagingSenderId: "836672752670",
  appId: "1:836672752670:web:9859d8dc9960c0478b320f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const appId = 'trust-inspection-coordinator';
const MAKE_WEBHOOK_URL = "https://hook.us2.make.com/dio2kjm5dmlcydacspdfclfuh4g73dvf";

// The Washing Machine: Cleans up terrible agent formatting
function sanitizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, ''); // Strips everything but numbers
  if (cleaned.length === 7) cleaned = '785' + cleaned; // Adds local area code if they forgot it
  if (cleaned.length === 11 && cleaned.startsWith('1')) cleaned = cleaned.substring(1); // Removes country code if they added it
  if (cleaned.length === 10) return `${cleaned.slice(0,3)}-${cleaned.slice(3,6)}-${cleaned.slice(6)}`; // Perfect formatting
  return phone; // Fallback if it's completely weird
}

export default async function handler(req, res) {
  // 1. Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawInput = req.body.description || req.body.rawText;
    if (!rawInput) {
      return res.status(400).json({ error: 'No GCal description provided' });
    }

    // 2. Fetch live vendors from Firebase
    const vendorsRef = collection(db, 'artifacts', appId, 'public', 'data', 'vendors');
    const vendorSnapshot = await getDocs(vendorsRef);
    const vendors = [];
    vendorSnapshot.forEach(doc => vendors.push(doc.data()));

    // 3. Parse the HomeGauge Text
    const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
    const jobId = crypto.randomUUID();
    
    let job = {
      id: jobId,
      createdBy: 'automated-make-system',
      createdAt: Date.now(),
      title: lines[0] || 'Automated Job',
      address: '',
      datetime: lines[1] || '',
      mainDate: '', 
      reportId: '',
      buyer: { name: '', email: '', phone: '' },
      buyerAgent: { name: '', email: '', phone: '' },
      services: [],
      status: 'new', 
      rawGCalText: rawInput, 
      access: {
        status: 'pending', 
        occupancy: '', 
        walkthrough: '',
        codes: {}, 
        instructions: '',
        listingAgent: { name: '', phone: '', email: '' }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes(', KS') || line.includes(', MO')) job.address = line;
      
      if (line.startsWith('Report ID:')) {
        const rawId = line.replace('Report ID:', '').trim();
        job.reportId = rawId;
        const dateMatch = rawId.match(/^(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          job.mainDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        } else if (lines[1]) {
          job.mainDate = lines[1].split('•')[0].trim();
        }
      }

      if (line.startsWith('Buyer -')) {
        job.buyer.name = line.replace('Buyer -', '').split('(')[0].trim();
        let j = i + 1;
        while(j < i + 7 && j < lines.length && !lines[j].startsWith("Buyer's Agent") && !lines[j].startsWith("Services")) {
          if (lines[j].startsWith('Mobile:')) job.buyer.phone = sanitizePhone(lines[j].replace('Mobile:', '').trim());
          if (lines[j].includes('@')) {
            const emailMatch = lines[j].match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
            if (emailMatch) job.buyer.email = emailMatch[0];
          }
          j++;
        }
      }

      if (line.startsWith("Buyer's Agent -")) {
        job.buyerAgent.name = line.replace("Buyer's Agent -", '').split('(')[0].trim();
        let j = i + 1;
        while(j < i + 7 && j < lines.length && !lines[j].startsWith('Services')) {
          if (lines[j].startsWith('Mobile:')) job.buyerAgent.phone = sanitizePhone(lines[j].replace('Mobile:', '').trim());
          if (lines[j].includes('@')) {
            const emailMatch = lines[j].match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
            if (emailMatch) job.buyerAgent.email = emailMatch[0];
          }
          j++;
        }
      }

      if (line.startsWith('Services (Total:')) {
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith('Report ID:')) {
          const serviceLine = lines[j];
          if (!serviceLine.includes('Home Inspection up to') && !serviceLine.includes('Home Inspection 2500')) {
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
                schedule: { date1: null, timeWindow1: null, date2: null, timeWindow2: null, requestedCalendar: false, calendarEmail: '' }
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
      job.buyerAgent = { ...job.buyer };
    }

    // AUTO-SCHEDULE INTERNAL SERVICES
    job.services = job.services.map(s => {
      if (s.email === 'Internal' || s.phone === 'Internal') {
        return {
          ...s,
          status: 'scheduled',
          schedule: {
            date1: job.mainDate,
            timeWindow1: job.datetime.split('•')[1]?.trim() || 'At Inspection Time',
            date2: null, timeWindow2: null,
            requestedCalendar: false, calendarEmail: ''
          }
        };
      }
      return s;
    });

    // 4. Save to Firebase Dashboard
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'jobs', jobId);
    await setDoc(docRef, job);

    const hasInternalSewer = job.services.some(s => s.email === 'Internal' || s.phone === 'Internal');
    const externalServices = job.services.filter(s => s.email !== 'Internal' && s.phone !== 'Internal');
    const baseUrl = `https://${req.headers.host}`;

    // 5. Fire Make.com Webhook
    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'job_created',
        address: job.address,
        job: job,
        hasInternalSewer: hasInternalSewer,
        agentLink: `${baseUrl}/#agent/${job.id}`,
        vendorLinks: externalServices.map(s => ({
          vendorName: s.vendor,
          email: s.email,
          phone: s.phone,
          type: s.type,
          link: `${baseUrl}/#vendor/${job.id}/${s.id}`
        })),
        fullSyncText: job.rawGCalText
      })
    });

    // Fast-track if no external vendors
    if (externalServices.length === 0) {
      await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'vendor_scheduled',
          jobId: job.id,
          address: job.address,
          vendorService: null,
          allScheduled: true,
          agentName: job.buyerAgent.name.split(' ')[0], 
          agentEmail: job.buyerAgent.email, 
          agentPhone: job.buyerAgent.phone,
          agentLink: `${baseUrl}/#agent/${job.id}`,
          fullSyncText: job.rawGCalText 
        })
      });
    }

    // 6. Return Success to Make.com HTTP module
    return res.status(200).json({ success: true, jobId: job.id });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}