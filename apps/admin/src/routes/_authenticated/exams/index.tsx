import { createFileRoute } from '@tanstack/react-router'
import { Exams } from '@/features/exams'

export const Route = createFileRoute('/_authenticated/exams/')({
  component: Exams,
})
