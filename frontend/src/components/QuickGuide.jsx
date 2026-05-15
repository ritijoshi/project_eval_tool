import React, { useState } from 'react';
import { 
  HelpCircle, 
  ChevronDown, 
  ChevronUp,
  BarChart3,
  Upload,
  Settings,
  Bot,
  BookOpen,
  Zap,
  Target,
  MessageSquare,
  Award,
  FileText,
  Users,
  LayoutDashboard
} from 'lucide-react';

const QuickGuide = ({ role = 'student' }) => {
  const [expanded, setExpanded] = useState(true);
  const [expandedSection, setExpandedSection] = useState(0);

  const guides = {
    student: [
      {
        title: 'Dashboard Overview',
        icon: LayoutDashboard,
        content:
          'View your personalized learning dashboard. This is your starting point where you can see your current learning topics, AI teaching assistant, and other course materials.',
        color: '#0A84FF',
      },
      {
        title: 'AI Project Evaluation',
        icon: FileText,
        content:
          'Submit your projects for AI-powered evaluation. You can upload code, documents, or paste text directly. Provide a rubric describing what will be evaluated, and the AI will score your work based on the criteria you specify.',
        color: '#8E24AA',
      },
      {
        title: 'Learning Path',
        icon: Target,
        content:
          'Follow your personalized learning roadmap created by the AI based on your performance and learning goals. Topics are adaptively selected to help you progress efficiently.',
        color: '#34C759',
      },
      {
        title: 'Course Modules',
        icon: BookOpen,
        content:
          'Access course materials uploaded by your professor. These materials are indexed and searchable through the Course Agent for easy reference.',
        color: '#FF9500',
      },
      {
        title: 'Team & Analytics',
        icon: Users,
        content:
          'View team-based analytics and collaborative learning insights. See how you are progressing relative to learning objectives.',
        color: '#00C7BE',
      },
      {
        title: 'Using the Course Agent',
        icon: MessageSquare,
        content:
          'Click the chat bubble in the bottom right to open the Course Agent. Select your course, choose your learning level (Beginner/Intermediate/Advanced), and ask questions about the course materials. The AI will answer based on your professor\'s uploaded materials.',
        color: '#0A84FF',
      },
    ],
    professor: [
      {
        title: 'Analytics Hub',
        icon: BarChart3,
        content:
          'Monitor student progress across all courses and topics. View performance metrics, identify weak areas, and understand which students need additional support. Use filters to focus on specific courses, students, or topics.',
        color: '#0A84FF',
        section: 'MONITORING',
      },
      {
        title: 'Material Ingestion',
        icon: Upload,
        content:
          'Upload your course materials (PDFs, Word docs, PowerPoints, audio files). Provide a course identifier and customize your teaching style instructions. These materials will be indexed and made available to your students through the Course Agent.',
        color: '#8E24AA',
        section: 'CONTENT',
      },
      {
        title: 'Define Rubrics',
        icon: Award,
        content:
          'Create evaluation rubrics for your assignments. These rubrics will be used by the AI to evaluate student projects with consistent criteria based on your learning objectives.',
        color: '#34C759',
        section: 'EVALUATION',
      },
      {
        title: 'Agent Console',
        icon: Settings,
        content:
          'Manage and configure the AI Course Agent behavior. Fine-tune how the agent responds to students and customize the learning experience for your courses. Adjust response styles and knowledge constraints.',
        color: '#FF9500',
        section: 'CONFIGURATION',
      },
      {
        title: 'Using Material Ingestion',
        icon: Zap,
        content:
          'Step-by-step: Go to "Material Ingestion" tab → Provide course code (e.g., CS501) → Upload your teaching materials (PDF, DOCX, PPTX, or audio) → Customize teaching style instructions that guide AI explanations → Materials auto-index for Course Agent.',
        color: '#00C7BE',
        section: 'QUICK START',
      },
    ],
  };

  const currentGuides = guides[role] || guides.student;
  const isProfessor = role === 'professor';

  // Group professor guides by section
  const groupedGuides = isProfessor 
    ? currentGuides.reduce((acc, guide) => {
        const section = guide.section || 'OTHER';
        if (!acc[section]) acc[section] = [];
        acc[section].push(guide);
        return acc;
      }, {})
    : null;

  const sectionOrder = ['QUICK START', 'MONITORING', 'CONTENT', 'EVALUATION', 'CONFIGURATION'];

  return (
    <div className="quick-guide-container mb-8">
      {/* Header Section */}
      <div
        className="quick-guide-header cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="quick-guide-header-content">
          <div className="quick-guide-icon-wrapper">
            <HelpCircle size={28} />
          </div>
          <div>
            <h2 className="quick-guide-title">
              {isProfessor ? "Professor's Quick Guide" : "Student's Quick Guide"}
            </h2>
            <p className="quick-guide-subtitle">
              {isProfessor 
                ? "Master the Professor Hub - Tips & Tutorials"
                : "Get Started - Essential Tips & Tutorials"}
            </p>
          </div>
        </div>
        <button className="quick-guide-toggle">
          {expanded ? (
            <ChevronUp size={22} />
          ) : (
            <ChevronDown size={22} />
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="quick-guide-content">
          {isProfessor ? (
            // Professor Dashboard - Organized by Section
            <div className="quick-guide-sections">
              {sectionOrder.map(
                (sectionName) =>
                  groupedGuides[sectionName] && (
                    <div key={sectionName} className="quick-guide-section">
                      <div className="quick-guide-section-header">
                        <span className="quick-guide-section-label">{sectionName}</span>
                        <div className="quick-guide-section-divider"></div>
                      </div>
                      <div className="quick-guide-section-items">
                        {groupedGuides[sectionName].map((guide, idx) => {
                          const IconComponent = guide.icon;
                          return (
                            <div key={idx} className="quick-guide-item">
                              <button
                                onClick={() =>
                                  setExpandedSection(
                                    expandedSection === `${sectionName}-${idx}` ? -1 : `${sectionName}-${idx}`
                                  )
                                }
                                className="quick-guide-item-header"
                              >
                                <div className="quick-guide-item-icon" style={{ color: guide.color }}>
                                  <IconComponent size={20} />
                                </div>
                                <span className="quick-guide-item-title">{guide.title}</span>
                                {expandedSection === `${sectionName}-${idx}` ? (
                                  <ChevronUp size={18} />
                                ) : (
                                  <ChevronDown size={18} />
                                )}
                              </button>
                              {expandedSection === `${sectionName}-${idx}` && (
                                <div className="quick-guide-item-content">
                                  <p>{guide.content}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
              )}
            </div>
          ) : (
            // Student Dashboard - Simple List
            <div className="quick-guide-items-list">
              {currentGuides.map((guide, index) => {
                const IconComponent = guide.icon;
                return (
                  <div key={index} className="quick-guide-item">
                    <button
                      onClick={() => setExpandedSection(expandedSection === index ? -1 : index)}
                      className="quick-guide-item-header"
                    >
                      <div className="quick-guide-item-icon" style={{ color: guide.color }}>
                        <IconComponent size={20} />
                      </div>
                      <span className="quick-guide-item-title">{guide.title}</span>
                      {expandedSection === index ? (
                        <ChevronUp size={18} />
                      ) : (
                        <ChevronDown size={18} />
                      )}
                    </button>
                    {expandedSection === index && (
                      <div className="quick-guide-item-content">
                        <p>{guide.content}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuickGuide;
