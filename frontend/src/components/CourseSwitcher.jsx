import React from 'react';
import { useActiveCourse } from '../context/ActiveCourseContext';

export default function CourseSwitcher({ allowAll = true, label = 'Active Course' }) {
  const { courses, loading, activeCourseId, setActiveCourseId, activeCourse } = useActiveCourse();
  const hasCourses = Array.isArray(courses) && courses.length > 0;
  const subtitle =
    activeCourseId && activeCourseId !== 'all' && activeCourse?.courseCode
      ? activeCourse.courseCode
      : loading
        ? 'Loading…'
        : `${courses.length} course${courses.length === 1 ? '' : 's'}`;

  return (
    <div className="course-switcher" role="group" aria-label={label}>
      <div className="course-switcher-meta">
        <span className="course-switcher-label">{label}</span>
        <span className="course-switcher-subtitle">{subtitle}</span>
      </div>

      <div className="course-switcher-control">
        <select
          className="course-switcher-select"
          value={activeCourseId || ''}
          onChange={(e) => setActiveCourseId(e.target.value)}
          disabled={loading || (!allowAll && !hasCourses)}
        >
          {allowAll && <option value="all">All Courses</option>}
          {!allowAll && !activeCourseId && <option value="">Select a course</option>}
          {!hasCourses && <option value="" disabled>No courses yet</option>}
          {courses.map((course) => (
            <option key={course._id} value={course._id}>
              {course.title} ({course.courseCode})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
