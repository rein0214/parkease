const express = require('express');
const mongoose = require('mongoose');
const { engine } = require('express-handlebars');
const path = require('path');
const app = express();
const session = require('express-session');
const PORT = process.env.PORT || 3000;
const MongoStore = require('connect-mongo');
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.isAdmin) {
        next(); 
    } else {
        res.status(403).send("Access Denied: Admins Only");
    }
};


const hbs = require('hbs'); 
const generateUserId = () => "DRV-" + Math.random().toString(36).substring(2, 7).toUpperCase();

hbs.registerHelper('shortId', function(id) {
    if (!id) return "N/A";
    return id.toString().substring(0, 8).toUpperCase();
});

// --- 1. DATABASE CONNECTION ---
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI)
    .then(() => console.log("Connected to MongoDB!"))
    .catch(err => console.error("Connection error:", err));

// --- 2. HANDLEBARS SETUP ---
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    helpers: {
        statusClass: function(status) {
            switch (status) {
                case 'Upcoming': return 'Upcoming';
                case 'Checked-In': return 'Checked-In';
                case 'Completed': return 'Completed';
                case 'Cancelled': return 'Cancelled';
                default: return 'pending';
            }
        },

        eq: function (a, b) { return a === b; },

        isBooked: function (slotName, time, bookedArray) {
            let list = [];
            try {
                list = typeof bookedArray === 'string' ? JSON.parse(bookedArray) : bookedArray;
            } catch (e) { list = []; }

            const target = `${slotName}|${time}`;

            const matched = list.includes(target);

            return matched;
        },

        formatTimeRange: function(timeSlots) {
            if (!timeSlots || timeSlots.length === 0) return "";

            const timesOnly = timeSlots.map(s => s.split('|')[1]).sort();
            const slotName = timeSlots[0].split('|')[0];

            const startTime = timesOnly[0];

            const lastSlot = timesOnly[timesOnly.length - 1];
            let [hours, minutes] = lastSlot.split(':').map(Number);
            minutes += 30;
            if (minutes >= 60) {
                hours += 1;
                minutes = 0;
            }
            const endTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

            return `${slotName} | ${startTime} - ${endTime}`;
        },

        formatTime: function(timeSlots) {
            if (!timeSlots || timeSlots.length === 0) return "";

            const to12Hour = (timeStr) => {
                let [hours, minutes] = timeStr.split(':').map(Number);
                const period = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12 || 12; 
                return `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
            };

            const timesOnly = timeSlots.map(s => s.split('|')[1]).sort();
            
            const startTime = to12Hour(timesOnly[0]);

            const lastSlot = timesOnly[timesOnly.length - 1];
            let [hours, minutes] = lastSlot.split(':').map(Number);
            minutes += 30;
            if (minutes >= 60) {
                hours += 1;
                minutes = 0;
            }
            
            const endTime = to12Hour(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);

            return `${startTime} - ${endTime}`;
        },

        getSlotOnly: function(timeSlots) {
            if (!Array.isArray(timeSlots) || timeSlots.length === 0) return "N/A";
        
            const firstEntry = timeSlots[0]; 
            
            return firstEntry.split('|')[0];
        },

        getReservationStatus: function(dateStr, timeSlots) {
            if (!dateStr || !timeSlots || timeSlots.length === 0) return "Upcoming";

            const now = new Date();
            const resDate = new Date(`${dateStr}, 2026`); 
            
            const times = timeSlots.map(s => s.split('|')[1]).sort();
            const startTimeStr = times[0]; 
            const endTimeStr = times[times.length - 1]; 

            const start = new Date(resDate);
            const [sH, sM] = startTimeStr.split(':');
            start.setHours(parseInt(sH), parseInt(sM), 0);

            const end = new Date(resDate);
            const [eH, eM] = endTimeStr.split(':');
            end.setHours(parseInt(eH), parseInt(eM), 0);
            end.setMinutes(end.getMinutes() + 30); 

            if (now < start) return "Upcoming";
            if (now >= start && now <= end) return "Active";
            return "Completed";
        },

        getStartTime: function(timeSlots) {
            if (!timeSlots || timeSlots.length === 0) return "";
            const times = timeSlots.map(s => s.split('|')[1]).sort();
            return times[0];
        },
        getEndTime: function(timeSlots) {
            if (!timeSlots || timeSlots.length === 0) return "";
            const times = timeSlots.map(s => s.split('|')[1]).sort();
            return times[times.length - 1];
        },

        isPast: function(dateStr, timeStr) {
            const todayStr = new Date().toDateString().slice(4, 10);
            if (dateStr !== todayStr) return false; 

            const now = new Date();
            const [h, m] = timeStr.split(':').map(Number);
            const slotTime = new Date();
            slotTime.setHours(h, m, 0, 0);
            
            return now > slotTime;
        }
    }
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// --- 3. MIDDLEWARE ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'parkease-secret-key', 
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));
app.use((req, res, next) => {
    res.locals.user = req.session.user || null; 
    next();
});

app.set('trust proxy', 1); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'parkease-secret-key',
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
    mongooseConnection: mongoose.connection
    }),
    cookie: { 
        secure: true, 
        sameSite: 'lax', 
        maxAge: 1000 * 60 * 60 * 24 
    }
}));


// --- 4. MODELS ---
const User = require('./models/user'); 
const Reservation = require('./models/reservation');

// --- 5. ROUTES ---

app.get('/', (req, res) => {
    res.render('homepage', { 
        style: '<link rel="stylesheet" href="/css/homepage.css">' 
    });
});

app.get('/signup', (req, res) => {
    res.render('signup', { 
        style: '<link rel="stylesheet" href="/css/signup.css">' 
    });
});

app.get('/user-login', (req, res) => {
    res.render('user-login', { 
        style: '<link rel="stylesheet" href="/css/user-login.css">' 
    });
});

app.get('/mainpage', async (req, res) => {
    if (!req.session.user) return res.redirect('/user-login');

    try {
        const user = await User.findOne({ email: req.session.user.email }).lean();

        const firstName = user.fullName ? user.fullName.split(' ')[0] : "Driver";

        res.render('mainpage', { 
            style: '<link rel="stylesheet" href="/css/mainpage.css">',
            user: user,
            firstName: firstName 
        });
    } catch (err) {
        res.status(500).send("Error loading main page.");
    }
});

app.get('/user-signup', (req, res) => {
    const role = req.query.role || 'member';

    res.render('user-signup', { 
        style: '<link rel="stylesheet" href="/css/user-signup.css">', 
        role: role
    });
});

app.get('/menu', (req, res) => {
    if (!req.session.user) return res.redirect('/user-login');
    res.render('menu', { user: req.session.user, layout: false});
});

app.get('/profile', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/user-login');
    }

    try {
        const user = await User.findOne({ email: req.session.user.email }).lean();

        res.render('profile', { 
            style: '<link rel="stylesheet" href="/css/profile.css">',
            user: user 
        });
    } catch (err) {
        res.status(500).send("Error loading profile.");
    }
});

app.get('/reservation-details', async (req, res) => {
    if (!req.session.user) return res.redirect('/user-login');

    try {
        const reservationId = req.query.id;
        const loggedInId = req.session.user.userId;
        
        if (!reservationId) return res.redirect('/view-reservations');

        const reservation = await Reservation.findOne({ 
            _id: reservationId, 
            userId: loggedInId 
        }).lean();

        if (!reservation) {
            return res.redirect('/view-reservations');
        }

        const allBookings = await Reservation.find({ 
            branch: reservation.branch, 
            date: reservation.date 
        }).lean();

        const occupiedByOthers = allBookings
            .filter(b => b._id.toString() !== reservation._id.toString())
            .flatMap(b => b.timeSlots);

        const masterTimes = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", 
                             "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", 
                             "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", 
                             "16:00", "16:30", "17:00"];

        const currentSlotName = reservation.timeSlots[0].split('|')[0];
        
        const availableOptions = masterTimes.filter(time => {
            return !occupiedByOthers.includes(`${currentSlotName}|${time}`);
        });

        res.render('reservation-details', {
            style: '<link rel="stylesheet" href="/css/reservation-details.css">',
            res: reservation, 
            availableOptions: availableOptions 
        });
    } catch (err) {
        console.error("Details Error:", err);
        res.status(500).send("Error loading details.");
    }
});

app.get('/view-reservations', async (req, res) => {
    if (!req.session.user) return res.redirect('/user-login');

    try {
        const currentUserId = req.session.user.userId;

        const reservations = await Reservation.find({ 
            userId: currentUserId 
        }).lean();

        reservations.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.render('view-reservations', {
            style: '<link rel="stylesheet" href="/css/view-reservations.css">',
            reservations: reservations,
            layout: 'main'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching reservations.");
    }
});

app.get('/slot-reservation', async (req, res) => {
    const currentBranch = req.query.branch || "A";
    const todayStr = new Date().toDateString().slice(4, 10); // e.g., "Mar 24"
    const selectedDate = req.query.date || todayStr;

    try {
        const existingBookings = await Reservation.find({ 
            branch: currentBranch, 
            date: selectedDate 
        }).lean();

        const bookedSlots = existingBookings.flatMap(r => r.timeSlots);
        const times = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", 
                       "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", 
                       "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", 
                       "16:00", "16:30", "17:00"];
    
        const slotNames = ["Slot 1", "Slot 2", "Slot 3", "Slot 4"];
        
        // --- NEW TIME-AWARE LOGIC ---
        const now = new Date();
        const isToday = selectedDate === todayStr;

        const slotsWithStatus = slotNames.map(name => {
            // Filter only for times that are in the future relative to "now"
            const futureTimes = times.filter(t => {
                if (!isToday) return true; // If viewing a future date, all times are future
                const [h, m] = t.split(':').map(Number);
                const slotDateTime = new Date(); // Today
                slotDateTime.setHours(h, m, 0, 0);
                return slotDateTime > now;
            });

            const totalFutureSlots = futureTimes.length;
            const occupiedFutureCount = bookedSlots.filter(s => {
                const [sName, sTime] = s.split('|');
                return sName === name && futureTimes.includes(sTime);
            }).length;

            let statusClass = "green-bg"; 
            
            // If the day is over or all remaining slots are taken
            if (totalFutureSlots === 0 || occupiedFutureCount === totalFutureSlots) {
                statusClass = "red-bg";    
            } else if (occupiedFutureCount > 0) {
                statusClass = "yellow-bg"; 
            }

            return { name: name, statusClass: statusClass };
        });

        const availableDates = [];
        for (let i = 0; i < 7; i++) {
            let d = new Date();
            d.setDate(d.getDate() + i);
            availableDates.push(d.toDateString().slice(4, 10)); 
        }

        res.render('slot-reservation', { 
            style: '<link rel="stylesheet" href="/css/slot-reservation.css">',
            branch: currentBranch,
            times: times,
            slots: slotsWithStatus, 
            availableDates: availableDates,
            activeDate: selectedDate,
            bookedSlots: JSON.stringify(bookedSlots),
            isToday: isToday // Pass this to HBS to make template logic easier
        });
    } catch(err) {
        console.error(err);
        res.status(500).send("Error loading page.");
    }
});

app.get('/admin-mainpage', async (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).send("Access Denied");
    }

    try {
        const totalUsers = await User.countDocuments({ isAdmin: false });
        const allReservations = await Reservation.find().lean();
        
        // --- UPDATED REVENUE LOGIC ---
        // Only sum totalPrice if isPaid is true
        const totalRevenue = allReservations
            .filter(r => r.isPaid === true) 
            .reduce((sum, r) => sum + (Number(r.totalPrice) || 0), 0);

        const today = new Date().toDateString().slice(4, 10);
        const todaysBookings = allReservations.filter(r => r.date === today);

        const latestBookings = allReservations.slice(-5).reverse().map(rev => ({
            ...rev,
            displayUserId: rev.userId || "WALK-IN", 
            displayId: rev.bookingId
        }));

        res.render('admin-mainpage', {
            style: '<link rel="stylesheet" href="/css/admin-mainpage.css">',
            stats: {
                userCount: totalUsers,
                revenue: totalRevenue.toLocaleString(), // Adds commas for readability (e.g., 1,000)
                activeToday: todaysBookings.length
            },
            latestBookings: latestBookings
        });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Admin Dashboard Error");
    }
});

app.get('/admin-reservations', async (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) return res.redirect('/user-login');

    try {
        const allReservations = await Reservation.find().sort({ date: -1, _id: -1 }).lean();
        
        const now = new Date();
        const currentTimeStr = now.getHours().toString().padStart(2, '0') + ":" + 
                               now.getMinutes().toString().padStart(2, '0');
        const today = new Date().toDateString().slice(4, 10);

        const processedReservations = allReservations.map(rev => {
            const firstSlotEntry = rev.timeSlots[0] || "";
            const slotName = firstSlotEntry.split('|')[0] || "??";

            const times = rev.timeSlots.map(s => s.split('|')[1]).sort();
            const startTime = times[0];
            const endTime = times[times.length - 1];
            
            let isOverstaying = false;
            if (rev.date === today && rev.status !== 'Completed' && currentTimeStr > endTime) {
                isOverstaying = true;
            }

            return {
                ...rev,
                displayUserId: rev.bookingId || "WALK-IN",
                slotName, 
                startTime,
                endTime,
                isOverstaying
            };
        });

        res.render('admin-reservations', {
            style: '<link rel="stylesheet" href="/css/admin-reservations.css">',
            reservations: processedReservations,
            today
        });
    } catch (err) {
        res.status(500).send("Error loading management page.");
    }
});

app.post('/signup-submit', async (req, res) => {

    const { role, email, password, fullName, phone } = req.body;
    
    try {
        const adminStatus = (role === 'admin');
        const customId = generateUserId();

        const newUser = new User({ 
            email, 
            password, 
            fullName, 
            userId: customId, 
            phone,
            isAdmin: adminStatus 
        });
        
        await newUser.save();
        
        res.redirect('/'); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Signup failed. Email might already exist.");
    }
});

app.post('/login-submit', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user && user.password === password) {
        req.session.user = { 
            email: user.email, 
            userId: user.userId,
            isAdmin: user.isAdmin 
        };

        req.session.save((err) => {
            if (err) return res.status(500).send("Session error");
            if (user.isAdmin) {
                res.redirect('/admin-mainpage');
            } else {
                res.redirect('/mainpage');
            }
        });
    } else {
        res.send("Invalid login");
    }
});

app.post('/reserve-submit', async (req, res) => {
    if (!req.session.user) return res.status(401).send("Please login to reserve.");

    try {
        const { branch, date, slots } = req.body;
        let currentUserId; 

        if (req.session.user.isAdmin === true) {
            currentUserId = "WALK-IN";
        } else {
            currentUserId = req.session.user.userId; 
        }

        if (!slots) return res.status(400).send("No slots selected.");
        const selectedSlots = Array.isArray(slots) ? slots : [slots];

        const newReservation = new Reservation({
            userId: currentUserId, 
            branch: branch,
            date: date,
            timeSlots: selectedSlots,
            totalPrice: selectedSlots.length * 50
        });

        await newReservation.save();
        
        if (req.session.user.isAdmin) {
            return res.redirect('/admin-mainpage');
        }

        res.redirect(`/slot-reservation?branch=${branch}&date=${date}`); 
    } catch (err) {
        console.error("Reservation Error:", err);
        res.status(500).send("Error saving reservation.");
    }
});

app.post('/reservation-action', async (req, res) => {
    const { reservationId, action } = req.body;

    try {
        const reservation = await Reservation.findById(reservationId);

        if (!reservation) {
            return res.status(404).send("Reservation not found.");
        }

        if (action === 'cancel') {
            if (reservation.isPaid) {
                return res.redirect('/admin-reservations'); 
            }

            await Reservation.findByIdAndDelete(reservationId);

            if (req.session.user && req.session.user.isAdmin) {
                return res.redirect('/admin-reservations');
            }
            return res.redirect('/view-reservations');
        }
        
        res.redirect('/view-reservations');
    } catch (err) {
        console.error("Action failed:", err);
        res.status(500).send("Action failed.");
    }
});

app.post('/reservation-update', async (req, res) => {
    const { reservationId, action, startTime, endTime } = req.body;

    try {
        if (action === 'cancel') {
            await Reservation.findByIdAndDelete(reservationId);
            return res.redirect('/view-reservations');
        }

        if (startTime >= endTime) {
            return res.send("<script>alert('End time must be after start time!'); window.history.back();</script>");
        }

        const currentRes = await Reservation.findById(reservationId);
        if (!currentRes) return res.status(404).send("Reservation not found");

        const slotName = currentRes.timeSlots[0].split('|')[0];
        const newTimeSlots = [];
        let current = startTime;

        while (current < endTime) {
            newTimeSlots.push(`${slotName}|${current}`);
            
            let [h, m] = current.split(':').map(Number);
            m += 30;
            if (m >= 60) { h += 1; m = 0; }
            current = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        }

        await Reservation.findByIdAndUpdate(reservationId, { 
            timeSlots: newTimeSlots,
            totalPrice: newTimeSlots.length * 20 
        });

        res.redirect('/view-reservations');

    } catch (err) {
        console.error(err);
        res.status(500).send("Operation failed.");
    }
});

app.post('/profile-update', async (req, res) => {
    if (!req.session.user) return res.redirect('/user-login');

    const { fullName, phone } = req.body;
    
    const userID = req.session.user.userId;

    try {
        const updatedUser = await User.findOneAndUpdate(
            { userId: userID }, 
            { fullName, phone }, 
            { new: true }
        );

        if (updatedUser) {
            
            req.session.user.fullName = updatedUser.fullName;
            
            res.redirect('/profile');
        } else {
            res.status(404).send("User not found.");
        }

    } catch (err) {
        res.status(500).send("Error updating profile.");
    }
});

app.post('/profile-delete', async (req, res) => {
    const { email } = req.body;

    try {

        const result = await User.findOneAndDelete({ email: email });

        if (result) {
            res.redirect('/');
        } else {
            res.status(404).send("User not found.");
        }
    } catch (err) {
        res.status(500).send("Could not delete account.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.send("Logout failed");
        res.redirect('/'); 
    });
});

app.get('/admin-users', async (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).send("Access Denied");
    }

    try {
        const users = await User.find({}).lean();

        res.render('admin-users', {
            style: '<link rel="stylesheet" href="/css/admin-users.css">',
            users: users,
            userCount: users.length
        });
    } catch (err) {
        res.status(500).send("Error loading users.");
    }
});

app.post('/admin-delete-user', async (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) return res.status(403).send("Unauthorized");
    
    try {
        await User.findByIdAndDelete(req.body.userId);
        res.redirect('/admin-users');
    } catch (err) {
        res.status(500).send("Failed to delete user.");
    }
});

app.post('/admin/update-payment', async (req, res) => {
    try {
        await Reservation.findByIdAndUpdate(req.body.resId, { isPaid: true });
        res.redirect('/admin-reservations');
    } catch (err) {
        console.error(err);
        res.status(500).send("Payment update failed");
    }
});

app.post('/admin/update-status', async (req, res) => {
    try {
        const { resId, newStatus } = req.body;
        await Reservation.findByIdAndUpdate(resId, { status: newStatus });
        res.redirect('/admin-reservations');
    } catch (err) {
        console.error(err);
        res.status(500).send("Status update failed");
    }
});

app.listen(PORT, () => {
    console.log(`ParkEase running on port ${PORT}`);
});