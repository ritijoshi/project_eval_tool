import React from 'react';
import { getStatusConfig } from '../../utils/statusHelpers';
import './ProgressTracker.css';

// React.memo used because this receives rapidly changing websocket data
// We don't want the surrounding parent container rerendering unless absolutely necessary.
export const ProgressTracker = React.memo(({ progress, status, processedStudents, totalStudents, error }) => {
    const config = getStatusConfig(status);

    return (
        <div className="progress-tracker card">
            <div className="progress-header">
                <h3>
                    {config.icon} {config.label}
                </h3>
                <span className="student-count">
                    {totalStudents > 0 ? `${processedStudents} / ${totalStudents} Students` : 'Booting...'}
                </span>
            </div>
            
            <div className="progress-bar-container">
                <div 
                    className={`progress-bar-fill ${config.pulse ? 'pulse-anim' : ''} ${status === 'FAILED' ? 'failed' : ''}`}
                    style={{ 
                        width: `${progress}%`,
                        backgroundColor: config.color 
                    }}
                />
            </div>
            
            {error && <div className="error-message">{error}</div>}
            
            {/* The visual pipeline stages mapped according to architecture specs */}
            <div className="stage-indicators">
                <span className={status === 'UPLOADED' ? 'active' : 'passed'}>Uploaded</span> › 
                <span className={status === 'EXTRACTING' ? 'active' : (progress > 5 ? 'passed' : 'pending')}>Extracting</span> › 
                <span className={status === 'ANALYZING_TRANSCRIPT' ? 'active' : (progress > 10 ? 'passed' : 'pending')}>Analysis</span> › 
                <span className={status === 'EVALUATING' ? 'active' : (progress >= 100 ? 'passed' : 'pending')}>Evaluating</span> › 
                <span className={status === 'COMPLETED' ? 'active' : 'pending'}>Done</span>
            </div>
        </div>
    );
});

export default ProgressTracker;
