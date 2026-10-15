import { Link } from 'react-router-dom';
import Reveal from './Reveal';
import { TECH_STACK } from '../../config/novaSolutions';

export default function TechConstellation() {
  const alt = `Nova Engineering technology stack, including ${TECH_STACK.map(t => t.name).join(', ')}`;

  return (
    <div className="nv-tech-panel" role="img" aria-label={alt}>
      <div className="nv-tech-panel-bg" />
      <Reveal className="nv-tech-panel-copy">
        <h2 className="nv-h2">Built With <span className="nv-accent-text">Technologies</span> We Trust.</h2>
        <p className="nv-lede">
          We select technologies to match the problem, architecture, and scale
          of each solution, from React, Java and Spring Boot, to AWS and
          LangChain/LangGraph for AI-driven workflows.
        </p>
        <Link to="/contact" className="nv-btn nv-btn-primary">Explore Our Solutions</Link>
      </Reveal>
      <img className="nv-tech-panel-mobile-img" src="/tech-stack-desktop.png" alt="" loading="lazy" />
    </div>
  );
}
