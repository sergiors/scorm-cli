import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import course from 'virtual:course-data';
import { CourseApp } from './App';
import './styles.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <StrictMode>
      <CourseApp course={course} />
    </StrictMode>,
  );
}
