import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Testimonial { content: string; author: string; role: string; avatar: string }

@Component({
  selector: 'app-testimonials',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './testimonials.component.html',
  styleUrls: ['./testimonials.component.css']
})
export class TestimonialsComponent {
  testimonials: Testimonial[] = [
    { content: "Cette plateforme a transformé notre façon de travailler. Nous avons gagné un temps précieux sur chaque projet.", author: 'Marie Dupont', role: 'CEO, TechStart', avatar: 'https://randomuser.me/api/portraits/women/44.jpg' },
    { content: "L'interface est intuitive et les fonctionnalités sont incroyablement puissantes. Je ne peux plus m'en passer.", author: 'Thomas Martin', role: 'Product Designer', avatar: 'https://randomuser.me/api/portraits/men/32.jpg' },
    { content: "Le support client est exceptionnel. Une équipe réactive qui comprend vraiment nos besoins.", author: 'Sophie Bernard', role: 'Marketing Director', avatar: 'https://randomuser.me/api/portraits/women/68.jpg' }
  ];
}
