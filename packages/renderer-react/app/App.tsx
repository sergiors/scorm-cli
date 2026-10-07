import type { Course } from './types';
import { CoursePlayer } from './components/CoursePlayer';

export interface CourseAppProps {
  course: Course;
}

export function CourseApp({ course }: CourseAppProps) {
  return <CoursePlayer course={course} />;
}
