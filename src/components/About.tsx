import { Phone } from 'lucide-react';
import { about, formatINR, lowestPrice, rooms } from '../data/site';
import { H2 } from './Heading';
import { Img } from './Img';

const facts = [
  { value: String(rooms.length), label: 'stay options' },
  { value: `From ${formatINR(lowestPrice)}`, label: 'per night' },
  { value: 'Maligaon', label: 'near Shiv Mandir' },
];

export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="section container-x">
      <div className="grid gap-2 rounded-[28px] bg-card p-2 md:grid-cols-2 md:gap-6 lg:gap-10">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] md:aspect-auto md:min-h-[440px] lg:min-h-[470px]">
          <Img
            name={about.image}
            alt={about.imageAlt}
            sizes="(min-width: 641px) 50vw, 100vw"
            className="size-full object-cover md:absolute md:inset-0"
          />
        </div>
        <div className="flex flex-col justify-center px-3 pb-5 pt-4 md:py-8 md:pr-6 lg:pr-12">
          <span className="w-fit rounded-full border border-ink/80 px-3 py-1 text-[11.5px] font-medium">{about.tag}</span>
          <H2 id="about-title" before="A stay that feels" accent="like home" className="mt-4" />
          <p className="mt-5 max-w-[540px] text-[14px] leading-[1.7] text-muted md:text-[15px]">{about.paragraph}</p>
          <hr className="my-6 border-hairline" />
          <dl className="flex flex-wrap gap-x-8 gap-y-4 md:gap-x-10">
            {facts.map((f) => (
              <div key={f.label} className="flex flex-col-reverse">
                <dt className="text-[11.5px] text-muted">{f.label}</dt>
                <dd className="text-[15px] font-semibold">{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <a href="#rooms" className="btn btn-dark h-11 px-5 text-[14px]">
              View Rooms
            </a>
            <a href="#contact" className="btn h-11 border border-ink/80 px-5 text-[14px] hover:bg-ink hover:text-white">
              <Phone size={15} aria-hidden="true" />
              Contact Us
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
