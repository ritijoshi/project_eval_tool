import React from 'react';
import { useActiveCourse } from '../context/ActiveCourseContext';

export default function CourseSwitcher({ allowAll = true, label = 'Active Course' }) {
  const { courses, loading, activeCourseId, setActiveCourseId } = useActiveCourse();

  return (
    <div className="course-switcher">
      <span className="course-switcher-label">{label}</span>
      <select
        className="course-switcher-select"
        value={activeCourseId || ''}
        onChange={(e) => setActiveCourseId(e.target.value)}
        disabled={loading}
      >
        {allowAll && <option value="all">All Courses</option>}
        {!allowAll && !activeCourseId && <option value="">Select a course</option>}
        {courses.map((course) => (
          <option key={course._id} value={course._id}>
            {course.title} ({course.courseCode})
          </option>
        ))}
      </select>
    </div>
  );
}
