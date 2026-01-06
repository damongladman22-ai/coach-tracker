import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import AdminLayout from '../components/AdminLayout';

/**
 * Admin Feedback Page
 * 
 * View and manage feedback submitted by parents/players
 */
export default function Feedback({ session }) {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, unread, read
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchFeedback();
  }, []);

  const fetchFeedback = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFeedback(data || []);
    } catch (err) {
      console.error('Error fetching feedback:', err);
      showToast('Failed to load feedback', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const markAsRead = async (id, isRead) => {
    try {
      const { error } = await supabase
        .from('feedback')
        .update({ is_read: isRead })
        .eq('id', id);

      if (error) throw error;

      setFeedback(prev => prev.map(f => 
        f.id === id ? { ...f, is_read: isRead } : f
      ));
      
      if (selectedFeedback?.id === id) {
        setSelectedFeedback(prev => ({ ...prev, is_read: isRead }));
      }
    } catch (err) {
      console.error('Error updating feedback:', err);
      showToast('Failed to update', 'error');
    }
  };

  const deleteFeedback = async (id) => {
    if (!confirm('Are you sure you want to delete this feedback?')) return;

    try {
      const { error } = await supabase
        .from('feedback')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setFeedback(prev => prev.filter(f => f.id !== id));
      if (selectedFeedback?.id === id) {
        setSelectedFeedback(null);
      }
      showToast('Feedback deleted');
    } catch (err) {
      console.error('Error deleting feedback:', err);
      showToast('Failed to delete', 'error');
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'suggestion': return '💡';
      case 'bug': return '🐛';
      case 'question': return '❓';
      case 'compliment': return '⭐';
      default: return '📝';
    }
  };

  const getTypeLabel = (type) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Filter feedback
  const filteredFeedback = feedback.filter(f => {
    if (filter === 'unread' && f.is_read) return false;
    if (filter === 'read' && !f.is_read) return false;
    if (typeFilter !== 'all' && f.type !== typeFilter) return false;
    return true;
  });

  // Stats
  const stats = {
    total: feedback.length,
    unread: feedback.filter(f => !f.is_read).length,
    suggestions: feedback.filter(f => f.type === 'suggestion').length,
    bugs: feedback.filter(f => f.type === 'bug').length,
    questions: feedback.filter(f => f.type === 'question').length
  };

  return (
    <AdminLayout session={session}>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Feedback</h1>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">Total</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.unread}</div>
            <div className="text-sm text-gray-500">Unread</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.suggestions}</div>
            <div className="text-sm text-gray-500">💡 Suggestions</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-red-600">{stats.bugs}</div>
            <div className="text-sm text-gray-500">🐛 Bugs</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-purple-600">{stats.questions}</div>
            <div className="text-sm text-gray-500">❓ Questions</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm"
              >
                <option value="all">All ({stats.total})</option>
                <option value="unread">Unread ({stats.unread})</option>
                <option value="read">Read ({stats.total - stats.unread})</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm"
              >
                <option value="all">All Types</option>
                <option value="suggestion">💡 Suggestions</option>
                <option value="bug">🐛 Bugs</option>
                <option value="question">❓ Questions</option>
                <option value="compliment">⭐ Compliments</option>
                <option value="other">📝 Other</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={fetchFeedback}
                className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading feedback...</p>
          </div>
        ) : filteredFeedback.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-4xl mb-4">📭</div>
            <p className="text-gray-600">
              {feedback.length === 0 
                ? 'No feedback received yet' 
                : 'No feedback matches your filters'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Feedback List */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="border-b px-4 py-3 bg-gray-50">
                <h2 className="font-semibold text-gray-700">
                  {filteredFeedback.length} {filteredFeedback.length === 1 ? 'Item' : 'Items'}
                </h2>
              </div>
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {filteredFeedback.map(item => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedFeedback(item);
                      if (!item.is_read) markAsRead(item.id, true);
                    }}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedFeedback?.id === item.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                    } ${!item.is_read ? 'bg-blue-50/50' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{getTypeIcon(item.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-medium ${!item.is_read ? 'text-blue-900' : 'text-gray-900'}`}>
                            {getTypeLabel(item.type)}
                          </span>
                          {!item.is_read && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">New</span>
                          )}
                          <span className="text-xs text-gray-400 ml-auto">{formatDate(item.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-600 truncate">{item.message}</p>
                        {item.name && (
                          <p className="text-xs text-gray-400 mt-1">From: {item.name}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail Panel */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              {selectedFeedback ? (
                <>
                  <div className="border-b px-4 py-3 bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{getTypeIcon(selectedFeedback.type)}</span>
                      <h2 className="font-semibold text-gray-700">{getTypeLabel(selectedFeedback.type)}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => markAsRead(selectedFeedback.id, !selectedFeedback.is_read)}
                        className={`px-3 py-1 text-xs rounded-full ${
                          selectedFeedback.is_read 
                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' 
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}
                      >
                        {selectedFeedback.is_read ? 'Mark Unread' : 'Mark Read'}
                      </button>
                      <button
                        onClick={() => deleteFeedback(selectedFeedback.id)}
                        className="px-3 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-full"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="mb-4">
                      <p className="text-sm text-gray-500 mb-1">Submitted</p>
                      <p className="text-gray-900">
                        {new Date(selectedFeedback.created_at).toLocaleString()}
                      </p>
                    </div>

                    {(selectedFeedback.name || selectedFeedback.email) && (
                      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500 mb-1">Contact Info</p>
                        {selectedFeedback.name && (
                          <p className="text-gray-900">{selectedFeedback.name}</p>
                        )}
                        {selectedFeedback.email && (
                          <a 
                            href={`mailto:${selectedFeedback.email}`}
                            className="text-blue-600 hover:underline"
                          >
                            {selectedFeedback.email}
                          </a>
                        )}
                      </div>
                    )}

                    <div className="mb-4">
                      <p className="text-sm text-gray-500 mb-1">Message</p>
                      <p className="text-gray-900 whitespace-pre-wrap">{selectedFeedback.message}</p>
                    </div>

                    <div className="pt-4 border-t">
                      <p className="text-sm text-gray-500 mb-1">Context</p>
                      <p className="text-xs text-gray-600">
                        Page: <code className="bg-gray-100 px-1 py-0.5 rounded">{selectedFeedback.page_url}</code>
                      </p>
                    </div>

                    {selectedFeedback.email && (
                      <div className="mt-4 pt-4 border-t">
                        <a
                          href={`mailto:${selectedFeedback.email}?subject=Re: Your Coach Tracker Feedback&body=%0A%0A---%0AOriginal feedback:%0A${encodeURIComponent(selectedFeedback.message)}`}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Reply via Email
                        </a>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <div className="text-4xl mb-4">👈</div>
                  <p>Select a feedback item to view details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'
        } text-white`}>
          {toast.message}
        </div>
      )}
    </AdminLayout>
  );
}
