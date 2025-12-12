import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import OPLogo from '../components/OPLogo'

export default function Help() {
  const [searchParams] = useSearchParams()
  const context = searchParams.get('context') || 'parent' // 'parent' or 'admin'
  const isAdminContext = context === 'admin'
  
  const [activeTab, setActiveTab] = useState(context === 'admin' ? 'admin' : 'parent')
  const [expandedItems, setExpandedItems] = useState({})

  const toggleItem = (id) => {
    setExpandedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  const parentFAQ = [
    {
      id: 'p1',
      question: 'How do I log a coach who\'s watching our game?',
      answer: `1. Open the tracker link shared by your team manager
2. Tap on the game you're currently at
3. Tap "Add Coaches"
4. Search for the college (e.g., "Ohio State")
5. Check the box next to each coach you see from that school
6. Tap "Save" - done!

Repeat for each college program you spot on the sideline.`
    },
    {
      id: 'p2',
      question: 'What if the coach isn\'t in the system?',
      answer: `No problem! After searching for the school:
1. Tap "Add New Coach" 
2. Enter their first and last name
3. Add their title, email, or phone if you have it (optional)
4. Save - they'll be added to the database for everyone

Tip: Check the coach's lanyard or business card for their name and contact info.`
    },
    {
      id: 'p3',
      question: 'Can I edit or delete an entry?',
      answer: `Yes! This is a collaborative tool - any parent or player can edit or delete entries.

To remove a coach from a game:
1. Go to the game's attendance list
2. Find the coach you want to remove
3. Tap the "×" next to their name

Don't worry about mistakes - it's easy to add them back.`
    },
    {
      id: 'p4',
      question: 'What\'s the difference between the two summary views?',
      answer: `There are two ways to view attendance:

**By Game:** Shows each game with the colleges/coaches who attended. Good for reviewing what happened at each game.

**By College:** Groups all attendance by school. Good for seeing which programs showed the most interest (attended multiple games).

Toggle between them using the buttons at the top of the summary page.`
    },
    {
      id: 'p5',
      question: 'How do I find a coach\'s contact info?',
      answer: `Use the Coach Directory:
1. Tap "Directory" from the main menu
2. Search by school or coach name
3. Filter by division, state, or conference
4. Tap the email or phone to contact them directly

You can also add or update contact info if you have a coach's business card!`
    },
    {
      id: 'p6',
      question: 'Can I download the attendance data?',
      answer: `Yes! From the Summary page:
1. Scroll to the bottom
2. Tap "Export CSV"
3. A spreadsheet will download with all coaches, their contact info, and which games they attended

This is great for follow-up emails after the tournament.`
    },
    {
      id: 'p7',
      question: 'Multiple people are logging at the same time - is that okay?',
      answer: `Absolutely! The app is designed for this. Multiple parents and players can add coaches simultaneously without conflicts.

The page refreshes every few seconds, so you'll see each other's entries appear automatically. No need to coordinate - just log what you see!`
    },
    {
      id: 'p8',
      question: 'What if I\'m not sure which coach is which?',
      answer: `Some tips for identifying coaches:
• Look at their lanyard/credential - it usually has their name and school
• College coaches often wear school-branded gear
• Ask them! Most coaches are happy to hand out business cards
• If unsure, add what you know and someone else can update it later`
    }
  ]

  const adminFAQ = [
    {
      id: 'a1',
      question: 'How do I set up a new event?',
      answer: `1. Go to Admin Dashboard → Events
2. Click "Add Event"
3. Enter the event name and dates
4. Click "Save"

Next, you'll add teams and games to the event from the Event Detail page.`
    },
    {
      id: 'a2',
      question: 'How do I add teams and games to an event?',
      answer: `From the Event Detail page:
1. Click "Add Team" to assign club teams to this event
2. For each team, click "Add Game" to enter their schedule
3. Enter the date and opponent for each game

The system will automatically generate shareable links for each team.`
    },
    {
      id: 'a3',
      question: 'How do I share links with parents/players?',
      answer: `There are two types of links:

**Club-wide link** (/home): Share this in general club communications. Parents/players can find their team from here.

**Team-specific link**: Share this directly with team families via text, WhatsApp, or TeamSnap. It goes straight to their team's tracker.

Find both links on the Admin Dashboard and Event Detail pages. Tap "Copy" to copy to clipboard.`
    },
    {
      id: 'a4',
      question: 'How does the Bulk Import work?',
      answer: `The Bulk Import tool lets you add many coaches at once from a spreadsheet:

1. Go to Admin → Import Coaches
2. Upload an Excel or CSV file
3. Map your columns to our fields (school, first name, last name, email, etc.)
4. The system will match coaches to schools in our database
5. Review matches and fix any that didn't match
6. Click "Import" to add them all

After importing, run the Dedup tool to merge any duplicates.`
    },
    {
      id: 'a5',
      question: 'What does the Dedup Coaches tool do?',
      answer: `The Dedup (de-duplicate) tool finds and merges duplicate coach entries:

**Exact duplicates:** Same name at the same school (e.g., two "John Smith" entries for Ohio State)

**Fuzzy matches:** Similar names that might be the same person (e.g., "J. Smith" and "John Smith")

When you merge:
• All attendance records combine into the coach you keep
• Contact info (email, phone, title) is automatically preserved from both records
• The duplicate is deleted

Use this after bulk imports or when parents/players add coaches on-the-fly.`
    },
    {
      id: 'a6',
      question: 'What does the Dedup Schools tool do?',
      answer: `Similar to Dedup Coaches, but for school records:

Finds duplicate schools like:
• "Ohio State" and "Ohio State University"
• "St. Mary's" and "Saint Mary's"

When you merge:
• All coaches from the duplicate school move to the one you keep
• School info (city, state, division) is preserved from both records`
    },
    {
      id: 'a7',
      question: 'How does the Attendance Matrix work?',
      answer: `The Attendance Matrix is a grid view for bulk data entry:

• Rows = coaches (grouped by school)
• Columns = games
• Click checkboxes to mark attendance

This is ideal for:
• Post-event data entry from notes or photos
• Reviewing/editing attendance across all games at once
• Adding multiple coaches to multiple games quickly

Access it from the Event Detail page via the "Attendance Matrix" button.`
    },
    {
      id: 'a8',
      question: 'Where does the coach contact data come from?',
      answer: `Coach data comes from multiple sources:

1. **Parents/Players:** Add coaches on-the-fly during events
2. **Coach Directory:** Anyone can add/update contact info
3. **Bulk Import:** Upload purchased coach databases
4. **Manual Entry:** Admins can add coaches in Schools & Coaches

The Coach Directory is "crowd-sourced" - parents/players can contribute contact info they collect from business cards, making the database more complete over time.`
    },
    {
      id: 'a9',
      question: 'How do I export attendance data?',
      answer: `There are two export options:

**From Admin (Event Detail):** Click "Export CSV" on any team card. This exports that team's attendance with all coach details.

**From Parent/Player Summary:** Parents/players can also export from the Summary page.

The export includes:
• College name, division, conference, state
• Coach names and emails
• Which games each coach attended (as columns)`
    }
  ]

  const FAQItem = ({ item }) => {
    const isExpanded = expandedItems[item.id]
    
    return (
      <div className="border-b border-gray-200 last:border-0">
        <button
          onClick={() => toggleItem(item.id)}
          className="w-full py-4 px-4 flex justify-between items-center text-left hover:bg-gray-50"
        >
          <span className="font-medium text-gray-900 pr-4">{item.question}</span>
          <span className="text-gray-400 text-xl flex-shrink-0">
            {isExpanded ? '−' : '+'}
          </span>
        </button>
        {isExpanded && (
          <div className="px-4 pb-4 text-gray-600 whitespace-pre-line">
            {item.answer}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0a1628] text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link to={isAdminContext ? "/admin" : "/home"} className="flex items-center space-x-3">
              <OPLogo className="h-10 w-10" />
              <div>
                <h1 className="text-lg font-bold leading-tight">Coach Tracker</h1>
                <p className="text-xs text-blue-300">Help Center</p>
              </div>
            </Link>
            <Link
              to={isAdminContext ? "/admin" : "/home"}
              className="text-sm text-blue-300 hover:text-white"
            >
              ← Back
            </Link>
          </div>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Intro */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Coach Tracker</h2>
          <p className="text-gray-600">
            This app helps track which college coaches attend your team's games at showcases and tournaments. 
            Users log attendance during games, and the data is compiled into exportable reports for recruiting follow-up.
          </p>
        </div>

        {/* Tab Navigation - only show tabs if admin context */}
        {isAdminContext ? (
          <div className="flex mb-6 bg-white rounded-lg shadow-md p-1">
            <button
              onClick={() => setActiveTab('parent')}
              className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors ${
                activeTab === 'parent'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              👨‍👩‍👧 For Parents/Players
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex-1 py-3 px-4 rounded-md font-medium transition-colors ${
                activeTab === 'admin'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              ⚙️ For Admins
            </button>
          </div>
        ) : (
          <div className="flex mb-6 bg-white rounded-lg shadow-md p-1">
            <div className="flex-1 py-3 px-4 rounded-md font-medium bg-blue-600 text-white text-center">
              👨‍👩‍👧 Help for Parents/Players
            </div>
          </div>
        )}

        {/* Quick Start */}
        {activeTab === 'parent' && (
          <div className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg shadow-md p-6 mb-6 text-white">
            <h3 className="text-lg font-bold mb-3">🚀 Quick Start for Parents/Players</h3>
            <ol className="space-y-2 text-blue-50">
              <li><strong>1.</strong> Open the link your team manager shared</li>
              <li><strong>2.</strong> Tap on your current game</li>
              <li><strong>3.</strong> Tap "Add Coaches" and search for the college</li>
              <li><strong>4.</strong> Check the coaches you see and save</li>
              <li><strong>5.</strong> Repeat for each college on the sideline!</li>
            </ol>
          </div>
        )}

        {activeTab === 'admin' && isAdminContext && (
          <div className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg shadow-md p-6 mb-6 text-white">
            <h3 className="text-lg font-bold mb-3">🚀 Quick Start for Admins</h3>
            <ol className="space-y-2 text-blue-50">
              <li><strong>1.</strong> Create an Event (name + dates)</li>
              <li><strong>2.</strong> Add your club teams to the event</li>
              <li><strong>3.</strong> Enter each team's game schedule</li>
              <li><strong>4.</strong> Share the tracker links with parents/players</li>
              <li><strong>5.</strong> Export attendance data after the event!</li>
            </ol>
          </div>
        )}

        {/* FAQ Section */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">
              {activeTab === 'parent' ? 'Frequently Asked Questions' : 'Admin Guide'}
            </h3>
          </div>
          <div>
            {((activeTab === 'admin' && isAdminContext) ? adminFAQ : parentFAQ).map(item => (
              <FAQItem key={item.id} item={item} />
            ))}
          </div>
        </div>

        {/* Expand/Collapse All */}
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              const items = (activeTab === 'admin' && isAdminContext) ? adminFAQ : parentFAQ
              const allExpanded = items.every(item => expandedItems[item.id])
              const newState = {}
              items.forEach(item => {
                newState[item.id] = !allExpanded
              })
              setExpandedItems(newState)
            }}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            {((activeTab === 'admin' && isAdminContext) ? adminFAQ : parentFAQ).every(item => expandedItems[item.id])
              ? 'Collapse All'
              : 'Expand All'}
          </button>
        </div>

        {/* Still need help? */}
        <div className="mt-6 bg-gray-100 rounded-lg p-6 text-center">
          <p className="text-gray-600 mb-2">Still have questions?</p>
          <p className="text-sm text-gray-500">
            Contact your club administrator for help with this tool.
          </p>
        </div>

        {/* Navigation links */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <Link
            to={isAdminContext ? "/admin" : "/home"}
            className="bg-white rounded-lg shadow-md p-4 text-center hover:shadow-lg transition-shadow"
          >
            <div className="text-2xl mb-1">{isAdminContext ? '⚙️' : '🏠'}</div>
            <div className="font-medium text-gray-900">{isAdminContext ? 'Admin Dashboard' : 'Club Dashboard'}</div>
            <div className="text-sm text-gray-500">{isAdminContext ? 'Manage events' : 'View all events'}</div>
          </Link>
          <Link
            to="/directory"
            className="bg-white rounded-lg shadow-md p-4 text-center hover:shadow-lg transition-shadow"
          >
            <div className="text-2xl mb-1">📒</div>
            <div className="font-medium text-gray-900">Coach Directory</div>
            <div className="text-sm text-gray-500">Search contacts</div>
          </Link>
        </div>
      </main>
    </div>
  )
}
