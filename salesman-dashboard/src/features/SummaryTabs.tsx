import { useState } from 'react';
import Summary from './Summary';
import HistoryView from './history/HistoryView';

export default function SummaryTabs() {
  const [activeTab, setActiveTab] = useState<'TODAY' | 'HISTORY'>('TODAY');

  return (
    <div className="flex flex-col font-sans">
      <div className="ui-card flex mb-4 bg-white dark:bg-gray-800 p-1 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <button 
          aria-pressed={activeTab === 'TODAY'} onClick={() => setActiveTab('TODAY')}
          className={`flex-1 py-2 font-bold rounded-lg ${activeTab === 'TODAY' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >Today</button>
        <button 
          aria-pressed={activeTab === 'HISTORY'} onClick={() => setActiveTab('HISTORY')}
          className={`flex-1 py-2 font-bold rounded-lg ${activeTab === 'HISTORY' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >History</button>
      </div>

      {activeTab === 'TODAY' ? <Summary /> : <HistoryView />}
    </div>
  );
}
